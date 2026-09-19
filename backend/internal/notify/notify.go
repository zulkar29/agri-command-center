// Package notify delivers messages — alert activations and the weekly summary
// — to the people who should get them: the farm's Telegram chat, each user's
// own Telegram chat and each user's phone by SMS. Which channels fire is the
// owner's choice in the farm's notification settings; who receives is each
// user's profile (phone, Telegram chat id).
//
// Sending never blocks or breaks the caller: the irrigation engine calls this
// every tick, and an outage at Telegram or the SMS gateway must not stop the
// pump logic. Failures are only logged.
package notify

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	neturl "net/url"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/models"
)

var client = &http.Client{Timeout: 5 * time.Second}

// Telegram posts through a bot token.
type Telegram struct{ BotToken string }

// Send delivers text to one chat id.
func (t Telegram) Send(chatID, text string) error {
	return postJSON("https://api.telegram.org/bot"+t.BotToken+"/sendMessage",
		"", map[string]string{"chat_id": chatID, "text": text})
}

// SMS posts to a generic HTTP gateway: POST URL with the JSON body
// {"to": "<phone>", "text": "<message>"} and an optional bearer token; any 2xx
// is success. Most providers either accept this shape or sit behind a tiny
// adapter, which keeps provider specifics out of the farm code.
type SMS struct{ URL, Token string }

// Send delivers text to one phone number.
func (s SMS) Send(phone, text string) error {
	return postJSON(s.URL, s.Token, map[string]string{"to": phone, "text": text})
}

func postJSON(url, bearer string, body any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	res, err := client.Do(req)
	if err != nil {
		// a *url.Error repeats the URL, and Telegram's carries the bot token;
		// keep it out of the logs
		var uerr *neturl.Error
		if errors.As(err, &uerr) {
			return uerr.Err
		}
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return fmt.Errorf("status %d", res.StatusCode)
	}
	return nil
}

// Router fans one message out to every configured channel and recipient.
// A nil Telegram or SMS means that channel is not set up.
type Router struct {
	DB       *gorm.DB
	Telegram *Telegram
	SMS      *SMS
	// FarmChat is the shared Telegram chat (e.g. the family group); users'
	// own chats are added to it.
	FarmChat string
	// Sync delivers inline instead of in the background (tests).
	Sync bool
}

// Enabled reports whether any channel is configured, so main can skip the
// whole thing on a bare dev setup.
func (r *Router) Enabled() bool { return r != nil && (r.Telegram != nil || r.SMS != nil) }

// Alert is the alerts.Notifier: one activation message.
func (r *Router) Alert(farm *models.Farm, title, detail string) {
	r.Text(farm, "🚨 "+title+"\n"+detail)
}

// Text sends a message on the channels the farm has switched on.
func (r *Router) Text(farm *models.Farm, text string) {
	chats, phones := r.recipients(farm)
	deliver := func() {
		for _, chat := range chats {
			if err := r.Telegram.Send(chat, text); err != nil {
				log.Printf("notify: telegram %s: %v", chat, err)
			}
		}
		for _, phone := range phones {
			if err := r.SMS.Send(phone, text); err != nil {
				log.Printf("notify: sms %s: %v", phone, err)
			}
		}
	}
	if r.Sync {
		deliver()
		return
	}
	go deliver()
}

// recipients lists distinct Telegram chat ids and phone numbers to message.
func (r *Router) recipients(farm *models.Farm) (chats, phones []string) {
	var users []models.User
	if r.DB != nil {
		if err := r.DB.Find(&users).Error; err != nil {
			log.Printf("notify: loading users: %v", err)
		}
	}
	seen := map[string]bool{}
	add := func(list *[]string, v string) {
		if v = strings.TrimSpace(v); v != "" && !seen[v] {
			seen[v] = true
			*list = append(*list, v)
		}
	}
	if r.Telegram != nil && farm.Notif.Telegram {
		add(&chats, r.FarmChat)
		for _, u := range users {
			add(&chats, u.TelegramChat)
		}
	}
	if r.SMS != nil && farm.Notif.Sms {
		for _, u := range users {
			add(&phones, u.Phone)
		}
	}
	return chats, phones
}
