// Package crops holds the crop calendar templates: for each crop its family
// (for rotation), when to sow in Bangladesh, days to harvest, how thirsty it
// is and the usual jobs along the way. The data is crops.json, embedded in
// the binary, so a community contribution is a pull request on one JSON file.
//
// The values are sensible starting points, not agronomic advice: have the
// local agriculture extension officer check them for your area and variety.
package crops

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed crops.json
var raw []byte

// Task is one job at Day days after sowing/planting.
type Task struct {
	Day  int    `json:"day"`
	Text string `json:"text"`
}

// Template is one crop.
type Template struct {
	ID     string `json:"id"`
	Name   string `json:"name"`   // the Bangla name fields use in Field.Crop
	Family string `json:"family"` // botanical family slug, e.g. solanaceae
	// SowMonths are the calendar months (1-12) when sowing/planting suits.
	SowMonths     []int  `json:"sowMonths"`
	DaysToHarvest int    `json:"daysToHarvest"`
	WaterNeed     int    `json:"waterNeed"` // 1 low … 3 high
	Tasks         []Task `json:"tasks"`
}

var all = mustLoad(raw)

func mustLoad(b []byte) []Template {
	var t []Template
	if err := json.Unmarshal(b, &t); err != nil {
		panic(fmt.Sprintf("crops.json: %v", err))
	}
	seen := map[string]bool{}
	for _, c := range t {
		if c.ID == "" || c.Name == "" || c.Family == "" || c.DaysToHarvest < 1 || c.WaterNeed < 1 || c.WaterNeed > 3 || len(c.SowMonths) == 0 {
			panic(fmt.Sprintf("crops.json: incomplete template %+v", c))
		}
		if seen[c.ID] {
			panic("crops.json: duplicate id " + c.ID)
		}
		seen[c.ID] = true
	}
	return t
}

// All returns the templates (a copy, so callers cannot edit the shared list).
func All() []Template { return append([]Template(nil), all...) }

// ByID finds a template by its id.
func ByID(id string) (Template, bool) {
	for _, c := range all {
		if c.ID == id {
			return c, true
		}
	}
	return Template{}, false
}

// ByName finds a template by the crop name a field carries.
func ByName(name string) (Template, bool) {
	for _, c := range all {
		if c.Name == name {
			return c, true
		}
	}
	return Template{}, false
}
