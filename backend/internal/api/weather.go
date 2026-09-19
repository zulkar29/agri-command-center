package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// GET /api/v1/weather — current conditions + 3-day rain probability (Open-Meteo
// via internal/weather, cached 30 min). Requires the farm's coordinates,
// which the owner sets in settings (PATCH /api/v1/farm {lat, lng}).
func (a *API) getWeather(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	if a.Weather == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "এই সার্ভারে আবহাওয়ার সেবা চালু নেই।"})
		return
	}
	if farm.Lat == nil || farm.Lng == nil {
		unprocessable(c, "ফার্মের অবস্থান দেওয়া হয়নি — সেটিংসে অক্ষাংশ ও দ্রাঘিমাংশ বসান।")
		return
	}
	f, err := a.Weather.Get(c.Request.Context(), *farm.Lat, *farm.Lng)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "আবহাওয়ার সেবা পাওয়া যায়নি।"})
		return
	}
	c.JSON(http.StatusOK, f)
}
