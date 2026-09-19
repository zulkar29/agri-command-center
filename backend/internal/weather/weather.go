// Package weather fetches forecasts from Open-Meteo (no API key):
// current conditions plus three days of rain probability. Results are cached
// 30 minutes per location — both the /api/v1/weather handler and the
// irrigation engine's r1 rain-skip rule read the same cache.
package weather

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

const cacheTTL = 30 * time.Minute

// Day is one forecast day; Rain is the precipitation probability % (0..100),
// Date is the local day as YYYY-MM-DD.
type Day struct {
	Date string  `json:"date"`
	Rain float64 `json:"rain"`
}

// Forecast is what GET /api/v1/weather answers with.
type Forecast struct {
	Current struct {
		Temp     float64 `json:"temp"`
		Humidity float64 `json:"humidity"`
		Rain     float64 `json:"rain"` // mm since midnight
	} `json:"current"`
	Daily     []Day `json:"daily"` // today first, 3 entries
	FetchedAt int64 `json:"fetchedAt"`
}

type cached struct {
	f  *Forecast
	at time.Time
}

// Client is a caching forecast reader; zero value is not usable — call New.
type Client struct {
	http  *http.Client
	mu    sync.Mutex
	cache map[string]cached
}

func New() *Client {
	return &Client{
		http:  &http.Client{Timeout: 5 * time.Second},
		cache: map[string]cached{},
	}
}

// Get returns the cached forecast for the coordinates, fetching when stale.
func (c *Client) Get(ctx context.Context, lat, lng float64) (*Forecast, error) {
	key := fmt.Sprintf("%.4f,%.4f", lat, lng)
	c.mu.Lock()
	if hit, ok := c.cache[key]; ok && time.Since(hit.at) < cacheTTL {
		c.mu.Unlock()
		return hit.f, nil
	}
	c.mu.Unlock()

	f, err := c.fetch(ctx, lat, lng)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.cache[key] = cached{f: f, at: time.Now()}
	c.mu.Unlock()
	return f, nil
}

// RainTomorrow is the engine's read: tomorrow's rain probability, if known.
func (c *Client) RainTomorrow(ctx context.Context, lat, lng float64) (float64, bool) {
	f, err := c.Get(ctx, lat, lng)
	if err != nil || len(f.Daily) < 2 {
		return 0, false
	}
	return f.Daily[1].Rain, true
}

func (c *Client) fetch(ctx context.Context, lat, lng float64) (*Forecast, error) {
	u := fmt.Sprintf(
		"https://api.open-meteo.com/v1/forecast?latitude=%f&longitude=%f"+
			"&current=temperature_2m,relative_humidity_2m,precipitation"+
			"&daily=precipitation_probability_max&forecast_days=3&timezone=auto", lat, lng)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("open-meteo: status %d", res.StatusCode)
	}

	var raw struct {
		Current struct {
			Temperature2m      float64 `json:"temperature_2m"`
			RelativeHumidity2m float64 `json:"relative_humidity_2m"`
			Precipitation      float64 `json:"precipitation"`
		} `json:"current"`
		Daily struct {
			Time                        []string  `json:"time"`
			PrecipitationProbabilityMax []float64 `json:"precipitation_probability_max"`
		} `json:"daily"`
	}
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
		return nil, err
	}

	f := &Forecast{FetchedAt: time.Now().UnixMilli()}
	f.Current.Temp = raw.Current.Temperature2m
	f.Current.Humidity = raw.Current.RelativeHumidity2m
	f.Current.Rain = raw.Current.Precipitation
	for i, day := range raw.Daily.Time {
		if i >= 3 {
			break
		}
		rain := 0.0
		if i < len(raw.Daily.PrecipitationProbabilityMax) {
			rain = raw.Daily.PrecipitationProbabilityMax[i]
		}
		f.Daily = append(f.Daily, Day{Date: day, Rain: rain})
	}
	if len(f.Daily) == 0 {
		return nil, fmt.Errorf("open-meteo: empty forecast")
	}
	return f, nil
}
