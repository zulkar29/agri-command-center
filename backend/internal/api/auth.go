// Login/logout: password or Google sign-in resolves to a token pair — a
// short-lived JWT access token (stateless, jwt.go) plus a random refresh
// token backed by a sessions row (30 days, rotated on every refresh, deleted
// on logout). No JWT revocation list: a logged-out access token simply ages
// out within accessTTL, and refresh is dead immediately.
package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"github.com/farm-command/backend/internal/models"
)

// sessionTTL is how long a refresh token lasts; a client that outlives it
// just logs in again (the apps route back to their login screen on 401).
const sessionTTL = 30 * 24 * time.Hour

type loginReq struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type refreshReq struct {
	RefreshToken string `json:"refreshToken" binding:"required"`
}

type googleReq struct {
	IDToken string `json:"idToken" binding:"required"`
}

// login checks the credentials and returns the user plus a fresh token pair.
func (a *API) login(c *gin.Context) {
	var req loginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		// gin's validator message is developer-speak; the login screens show
		// this string to users
		c.JSON(http.StatusBadRequest, gin.H{"error": "সঠিক ইমেইল ও পাসওয়ার্ড দিন।"})
		return
	}

	var user models.User
	err := a.DB.Where("lower(email) = ?", strings.ToLower(req.Email)).First(&user).Error
	if err != nil || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)) != nil {
		// same message for unknown email and wrong password — no account probing
		unauthorized(c, "ইমেইল বা পাসওয়ার্ড মেলেনি।")
		return
	}
	a.respondTokens(c, &user)
}

// refresh exchanges a valid refresh token for a new pair, rotating the
// session row so an old refresh token never works twice.
func (a *API) refresh(c *gin.Context) {
	var req refreshReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "রিফ্রেশ টোকেন দিন।"})
		return
	}
	user, ok := a.userForRefreshToken(c, req.RefreshToken)
	if !ok {
		return
	}
	// the delete is the claim: of two refreshes racing with the same token
	// only the one that removed the row gets a new pair
	res := a.DB.Delete(&models.Session{}, "token = ?", req.RefreshToken)
	if res.Error != nil {
		serverError(c, res.Error)
		return
	}
	if res.RowsAffected == 0 {
		unauthorized(c, "লগইনের মেয়াদ শেষ — আবার লগইন করুন।")
		return
	}
	a.respondTokens(c, user)
}

// google verifies a Google ID token (from "Sign in with Google" on the
// dashboard/mobile), upserts the account by email and issues the app's token
// pair. Disabled with a clear error until GOOGLE_CLIENT_ID is configured.
func (a *API) google(c *gin.Context) {
	if a.GoogleClientID == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Google লগইন সেট করা হয়নি (GOOGLE_CLIENT_ID দিন)।"})
		return
	}
	var req googleReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Google টোকেন দিন।"})
		return
	}

	gu, err := verifyGoogleIDToken(c.Request.Context(), req.IDToken, a.GoogleClientID)
	if errors.Is(err, errGoogleUnreachable) {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		unauthorized(c, err.Error())
		return
	}

	// First login creates the account. Self-signups get the viewer role —
	// least privilege until an owner promotes them.
	// (emails are stored lower-case, as POST /users does)
	email := strings.ToLower(gu.Email)
	user := models.User{Name: gu.Name, Email: email, Role: models.RoleViewer}
	if err := a.DB.Where("lower(email) = ?", email).FirstOrCreate(&user).Error; err != nil {
		serverError(c, err)
		return
	}
	a.respondTokens(c, &user)
}

// authConfig tells the clients whether to show the Google button and with
// which client id (one place to configure, both apps read it).
func (a *API) authConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"googleClientId": a.GoogleClientID})
}

// me answers with the logged-in user's row. The token carries only
// id/name/email/role, so the row is read: contacts and a rename show up, and
// a deleted account stops resolving.
func (a *API) me(c *gin.Context) {
	var user models.User
	if err := a.DB.First(&user, "id = ?", currentUser(c).ID).Error; err != nil {
		unauthorized(c, "লগইন প্রয়োজন।")
		return
	}
	c.JSON(http.StatusOK, user)
}

// logout revokes the refresh session; the access token ages out on its own.
func (a *API) logout(c *gin.Context) {
	var req refreshReq
	_ = c.ShouldBindJSON(&req) // missing body → empty token → deletes nothing
	if req.RefreshToken != "" {
		a.DB.Delete(&models.Session{}, "token = ? AND user_id = ?", req.RefreshToken, currentUser(c).ID)
	}
	c.Status(http.StatusNoContent)
}

// requireAuth guards every route that is not in the open set: it verifies the
// bearer JWT and stores the user on the request context. Stateless — no
// session lookup, so revoked sessions still read until their access token
// expires (≤ accessTTL).
func (a *API) requireAuth(c *gin.Context) {
	token, ok := strings.CutPrefix(c.GetHeader("Authorization"), "Bearer ")
	if ok && token != "" {
		if claims, err := verifyAccess(token, a.JWTSecret); err == nil {
			c.Set("user", userFromClaims(claims))
			c.Set("tokenExp", claims.ExpiresAt.Time) // the stream closes then
			c.Next()
			return
		}
	}
	unauthorized(c, "লগইন প্রয়োজন।")
}

// currentUser pulls the user requireAuth stored; safe because every handler
// that calls it sits behind the middleware.
func currentUser(c *gin.Context) *models.User {
	user, _ := c.MustGet("user").(*models.User)
	return user
}

// requireRole gates a route on the caller's role. Router wiring decides the
// matrix: reads need none, irrigation/tasks/scout/device commands need
// অপারেটর, money/land/farm-setup need মালিক.
func requireRole(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		user := currentUser(c)
		for _, r := range roles {
			if user.Role == r {
				c.Next()
				return
			}
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"error": "এই কাজের অনুমতি আপনার ভূমিকার (" + user.Role + ") নেই।",
		})
	}
}

// respondTokens issues a new refresh session + access JWT for the user (200)
// and sweeps expired sessions while we're here.
func (a *API) respondTokens(c *gin.Context, user *models.User) {
	token, err := signAccess(user, a.JWTSecret)
	if err != nil {
		serverError(c, err)
		return
	}
	refresh := newToken()
	session := models.Session{Token: refresh, UserID: user.ID, ExpiresAt: time.Now().Add(sessionTTL)}
	if err := a.DB.Create(&session).Error; err != nil {
		serverError(c, err)
		return
	}
	a.DB.Delete(&models.Session{}, "expires_at <= ?", time.Now())

	c.JSON(http.StatusOK, gin.H{"user": user, "token": token, "refreshToken": refresh})
}

// userForRefreshToken loads the unexpired session's user or answers 401.
func (a *API) userForRefreshToken(c *gin.Context, token string) (*models.User, bool) {
	var session models.Session
	err := a.DB.Preload("User").
		Where("token = ? AND expires_at > ?", token, time.Now()).
		First(&session).Error
	if err != nil || session.User.ID == "" {
		unauthorized(c, "লগইনের মেয়াদ শেষ — আবার লগইন করুন।")
		return nil, false
	}
	return &session.User, true
}

// googleUser is the parts of a verified Google ID token we keep.
type googleUser struct {
	Email string
	Name  string
}

var googleHTTPClient = &http.Client{Timeout: 5 * time.Second}

// verifyGoogleIDToken asks Google's tokeninfo endpoint to check the
// signature and expiry, then enforces issuer, audience and a verified email.
// The JWKS-locally alternative saves the round-trip but adds key caching —
// fine to graduate to once this stops being a demo.
// errGoogleUnreachable marks a failure on Google's side (network, 5xx,
// unreadable answer): the token may be fine, so it is a 502, not a 401.
var errGoogleUnreachable = errors.New("Google-এর সাথে যোগাযোগ হয়নি। একটু পরে আবার চেষ্টা করুন।")

func verifyGoogleIDToken(ctx context.Context, idToken, clientID string) (*googleUser, error) {
	u := "https://oauth2.googleapis.com/tokeninfo?id_token=" + url.QueryEscape(idToken)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, errors.New("Google টোকেন যাচাই করা যায়নি।")
	}
	res, err := googleHTTPClient.Do(req)
	if err != nil {
		return nil, errGoogleUnreachable
	}
	defer res.Body.Close()
	if res.StatusCode >= 500 {
		return nil, errGoogleUnreachable
	}
	if res.StatusCode != http.StatusOK {
		return nil, errors.New("Google টোকেনটি আর বৈধ নয়।")
	}

	var info struct {
		Iss           string `json:"iss"`
		Aud           string `json:"aud"`
		Email         string `json:"email"`
		EmailVerified string `json:"email_verified"`
		Name          string `json:"name"`
	}
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil {
		return nil, errGoogleUnreachable
	}

	if info.Iss != "accounts.google.com" && info.Iss != "https://accounts.google.com" {
		return nil, errors.New("Google টোকেনটি আর বৈধ নয়।")
	}
	if info.Aud != clientID {
		return nil, errors.New("এই Google ক্লায়েন্টের জন্য টোকেন নয়।")
	}
	if info.Email == "" || info.EmailVerified != "true" {
		return nil, errors.New("Google অ্যাকাউন্টে যাচাই করা ইমেইল নেই।")
	}
	name := info.Name
	if name == "" {
		name = strings.SplitN(info.Email, "@", 2)[0]
	}
	return &googleUser{Email: info.Email, Name: name}, nil
}

// newToken returns 32 random bytes as hex — the refresh token itself.
func newToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return hex.EncodeToString(b)
}
