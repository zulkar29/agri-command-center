package crops

import "testing"

func TestTemplatesAreWellFormed(t *testing.T) {
	// mustLoad already panics on an incomplete or duplicate template; also
	// check the task offsets stay inside the crop's life.
	for _, c := range All() {
		for _, task := range c.Tasks {
			if task.Day < 0 || task.Day > c.DaysToHarvest || task.Text == "" {
				t.Fatalf("%s: bad task %+v", c.ID, task)
			}
		}
		for _, m := range c.SowMonths {
			if m < 1 || m > 12 {
				t.Fatalf("%s: bad month %d", c.ID, m)
			}
		}
	}
	if _, ok := ByName("টমেটো"); !ok {
		t.Fatal("tomato should be found by its Bangla name")
	}
	if _, ok := ByID("nope"); ok {
		t.Fatal("unknown id must miss")
	}
}
