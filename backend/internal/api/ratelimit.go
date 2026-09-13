package api

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// rateLimiter is a small fixed-window counter per client IP, enough to blunt
// password guessing on the credential endpoints without a Redis dependency.
// State is per process; a multi-instance deployment should front the API
// with a proxy-level limit as well.
type rateLimiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string]*window
	now    func() time.Time // injectable for tests
}

type window struct {
	start time.Time
	n     int
}

func newRateLimiter(max int, per time.Duration) *rateLimiter {
	return &rateLimiter{max: max, window: per, hits: map[string]*window{}, now: time.Now}
}

// allow records one hit for key and reports whether it is within the limit.
func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	w := l.hits[key]
	if w == nil || now.Sub(w.start) >= l.window {
		if len(l.hits) > 10_000 { // drop expired windows so memory stays bounded
			for k, v := range l.hits {
				if now.Sub(v.start) >= l.window {
					delete(l.hits, k)
				}
			}
		}
		l.hits[key] = &window{start: now, n: 1}
		return true
	}
	w.n++
	return w.n <= l.max
}

func (l *rateLimiter) middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !l.allow(c.ClientIP()) {
			c.Header("Retry-After", "60")
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "অনেকবার চেষ্টা করা হয়েছে। এক মিনিট পরে আবার চেষ্টা করুন।"})
			return
		}
		c.Next()
	}
}
