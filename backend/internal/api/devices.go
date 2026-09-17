package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/farm-command/backend/internal/models"
	"github.com/farm-command/backend/internal/pump"
)

// GET /api/v1/devices?page=&limit=&kind=&online= — kind is sensor|relay|gateway.
func (a *API) listDevices(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	p, ok := parsePaging(c, 50, 200)
	if !ok {
		return
	}
	q := a.DB.Where("farm_id = ?", farm.ID)
	if kind, ok := queryEnum(c, "kind", "sensor", "relay", "gateway"); !ok {
		return
	} else if kind != "" {
		q = q.Where("kind = ?", kind)
	}
	if online, ok := queryBool(c, "online"); !ok {
		return
	} else if online != nil {
		q = q.Where("online = ?", *online)
	}
	var devices []models.Device
	respondPaged(c, q, p, "id", &devices)
}

type deviceCommandReq struct {
	Command string `json:"command" binding:"required,oneof=on off"`
}

// deviceCommand (POST /api/v1/devices/:id/commands) pushes an on/off command
// to a relay, the REST stand-in for the MQTT topic farm/<slug>/pump/set
// described in docs/05-device-protocol.md. Like the other "the farm does
// something" collections it answers 201, with the relay row as it now is.
func (a *API) deviceCommand(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req deviceCommandReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}

	var device models.Device
	if !a.findInFarm(c, farm.ID, &device) {
		return
	}
	if device.Kind != "relay" {
		unprocessable(c, "কমান্ড শুধু রিলে ডিভাইসে চলে।")
		return
	}

	on := req.Command == "on"
	if _, err := pump.SetManual(a.DB, farm, on, time.Now()); err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "device.command", device.ID+" "+req.Command)

	// answer with the relay row as SetManual just updated it
	if !a.findInFarm(c, farm.ID, &device) {
		return
	}
	c.JSON(http.StatusCreated, device)
}

// GET /api/v1/devices/:id/key — the owner's view of a device's ingest key
// (models.Device.ApiKey), for configuring firmware. Empty means the node
// posts without a key.
func (a *API) deviceKey(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var device models.Device
	if !a.findInFarm(c, farm.ID, &device) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": device.ID, "apiKey": device.ApiKey})
}

// POST /api/v1/devices/:id/key — generate a fresh ingest key for a device
// (owner). The old key stops working immediately; flash the new one into the
// firmware. Returned once here and again by GET /api/v1/devices/:id/key.
func (a *API) rotateDeviceKey(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var device models.Device
	if !a.findInFarm(c, farm.ID, &device) {
		return
	}
	device.ApiKey = newToken()
	if err := a.DB.Model(&device).Update("api_key", device.ApiKey).Error; err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "device.key", device.ID)
	c.JSON(http.StatusCreated, gin.H{"id": device.ID, "apiKey": device.ApiKey})
}
