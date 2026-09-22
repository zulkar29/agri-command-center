package api

import (
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/models"
)

// User administration: the owner invites accounts, changes
// roles and resets passwords. Until email exists, "invite" = the owner sets
// a starting password and hands it over. Every account also appears in the
// farm's team list (TeamMember), which is what the settings page shows.

type createUserReq struct {
	Name     string `json:"name" binding:"required"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8"`
	Role     string `json:"role" binding:"required,oneof=মালিক অপারেটর দর্শক"`
	// Phone and TelegramChat are optional alert destinations (see contactError).
	Phone        string `json:"phone"`
	TelegramChat string `json:"telegramChat"`
}

var (
	phoneRe = regexp.MustCompile(`^\+?[0-9]{10,15}$`)
	chatRe  = regexp.MustCompile(`^(-?[0-9]{5,20}|@[A-Za-z0-9_]{5,32})$`)
)

// contactError checks the optional alert destinations; empty means "none".
func contactError(phone, chat string) error {
	if phone != "" && !phoneRe.MatchString(phone) {
		return errInvalid("phone", "digits with an optional leading +, 10-15 long")
	}
	if chat != "" && !chatRe.MatchString(chat) {
		return errInvalid("telegramChat", "a numeric chat id or @channel")
	}
	return nil
}

func validRole(role string) bool {
	return role == models.RoleOwner || role == models.RoleOperator || role == models.RoleViewer
}

// GET /api/v1/users?page=&limit=&q=&role= — accounts in the Paged envelope
// (owner only); q matches name or email.
func (a *API) listUsers(c *gin.Context) {
	p, ok := parsePaging(c, 50, 200)
	if !ok {
		return
	}
	q := a.DB.Model(&models.User{})
	if role, ok := queryEnum(c, "role", models.RoleOwner, models.RoleOperator, models.RoleViewer); !ok {
		return
	} else if role != "" {
		q = q.Where("role = ?", role)
	}
	q = search(q, c.Query("q"), "name", "email")
	var users []models.User
	respondPaged(c, q, p, "created_at", &users)
}

// POST /api/v1/users — invite an account with a starting password; it also
// joins the farm's team list.
func (a *API) createUser(c *gin.Context) {
	var req createUserReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	if err := contactError(req.Phone, req.TelegramChat); err != nil {
		badRequest(c, err)
		return
	}
	var count int64
	a.DB.Model(&models.User{}).Where("lower(email) = ?", strings.ToLower(req.Email)).Count(&count)
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "এই ইমেইলে অ্যাকাউন্ট আছে।"})
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		serverError(c, err)
		return
	}
	user := models.User{Name: req.Name, Email: strings.ToLower(req.Email), PasswordHash: string(hash), Role: req.Role, Phone: req.Phone, TelegramChat: req.TelegramChat}
	if err := a.DB.Create(&user).Error; err != nil {
		if isDuplicateKey(err) { // the same invite sent twice at once
			c.JSON(http.StatusConflict, gin.H{"error": "এই ইমেইলে অ্যাকাউন্ট আছে।"})
			return
		}
		serverError(c, err)
		return
	}
	a.addTeamMember(user)
	a.audit(c, "", "user.create", req.Email+" ("+req.Role+")")
	c.JSON(http.StatusCreated, user)
}

type patchUserReq struct {
	Name     *string `json:"name"`
	Role     *string `json:"role"`
	Password *string `json:"password" binding:"omitempty,min=8"`
	Phone    *string `json:"phone"`
	// TelegramChat is where this person's alerts go on Telegram.
	TelegramChat *string `json:"telegramChat"`
}

// PATCH /api/v1/users/:id — rename, promote/demote or reset a password (owner
// only). The owner cannot change their own role — that is how a farm ends up
// with no administrator. A reset also signs the account out everywhere (its
// refresh sessions end), since a reset is what an owner does after a leak.
func (a *API) patchUser(c *gin.Context) {
	me := currentUser(c)
	var user models.User
	if err := a.DB.First(&user, "id = ?", c.Param("id")).Error; err != nil {
		notFound(c)
		return
	}
	var req patchUserReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	if err := contactError(deref(req.Phone), deref(req.TelegramChat)); err != nil {
		badRequest(c, err)
		return
	}
	if req.Name != nil && strings.TrimSpace(*req.Name) == "" {
		badRequest(c, errInvalid("name", "not empty"))
		return
	}
	oldName, oldRole := user.Name, user.Role
	if req.Phone != nil {
		user.Phone = *req.Phone
	}
	if req.TelegramChat != nil {
		user.TelegramChat = *req.TelegramChat
	}
	if req.Role != nil {
		if !validRole(*req.Role) {
			badRequest(c, errInvalid("role", "মালিক | অপারেটর | দর্শক"))
			return
		}
		if user.ID == me.ID && *req.Role != models.RoleOwner {
			unprocessable(c, "নিজের ভূমিকা কমানো যাবে না — আগে অন্য মালিক বানান।")
			return
		}
		user.Role = *req.Role
	}
	if req.Name != nil {
		user.Name = *req.Name
	}
	if req.Password != nil {
		hash, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
		if err != nil {
			serverError(c, err)
			return
		}
		user.PasswordHash = string(hash)
	}
	err := a.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&user).Error; err != nil {
			return err
		}
		if req.Password != nil {
			return tx.Delete(&models.Session{}, "user_id = ?", user.ID).Error
		}
		return nil
	})
	if err != nil {
		serverError(c, err)
		return
	}
	a.syncTeamMember(user, oldName, oldRole)
	a.audit(c, "", "user.update", user.Email)
	c.JSON(http.StatusOK, user)
}

// DELETE /api/v1/users/:id — remove an account, its sessions and its team row.
func (a *API) deleteUser(c *gin.Context) {
	me := currentUser(c)
	if c.Param("id") == me.ID {
		unprocessable(c, "নিজের অ্যাকাউন্ট মুছবেন না।")
		return
	}
	var user models.User
	if err := a.DB.First(&user, "id = ?", c.Param("id")).Error; err != nil {
		notFound(c)
		return
	}
	farmID := a.firstFarmID()
	err := a.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&models.Session{}, "user_id = ?", user.ID).Error; err != nil {
			return err
		}
		if err := tx.Delete(&models.TeamMember{}, "farm_id = ? AND name = ?", farmID, user.Name).Error; err != nil {
			return err
		}
		return tx.Delete(&user).Error
	})
	if err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, "", "user.delete", user.Email)
	c.Status(http.StatusNoContent)
}

type changePasswordReq struct {
	CurrentPassword string `json:"currentPassword" binding:"required"`
	NewPassword     string `json:"newPassword" binding:"required,min=8"`
}

// POST /api/v1/auth/password — change your own password (any role) after
// proving the current one. Sessions stay valid; only future logins need the
// new password.
func (a *API) changePassword(c *gin.Context) {
	user := currentUser(c)
	var req changePasswordReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	var fresh models.User
	if err := a.DB.First(&fresh, "id = ?", user.ID).Error; err != nil {
		// the token outlived its account (deleted meanwhile), as in me
		unauthorized(c, "লগইন প্রয়োজন।")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(fresh.PasswordHash), []byte(req.CurrentPassword)) != nil {
		unprocessable(c, "এখনকার পাসওয়ার্ড মেলেনি।")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		serverError(c, err)
		return
	}
	fresh.PasswordHash = string(hash)
	if err := a.DB.Save(&fresh).Error; err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, "", "user.password", fresh.Email)
	c.Status(http.StatusNoContent)
}

// addTeamMember mirrors a new account into the farm's team list.
func (a *API) addTeamMember(user models.User) {
	a.DB.Create(&models.TeamMember{FarmID: a.firstFarmID(), Name: user.Name, Role: user.Role})
}

// syncTeamMember keeps the account's team row in step after a rename or a
// role change. Rows are matched by the old name and role — the demo dataset
// links them that way; a future users↔team foreign key can replace it. A
// rename that skipped this would orphan the row: deleteUser finds it by name.
func (a *API) syncTeamMember(user models.User, oldName, oldRole string) {
	if user.Name == oldName && user.Role == oldRole {
		return
	}
	if err := a.DB.Model(&models.TeamMember{}).
		Where("farm_id = ? AND name = ? AND role = ?", a.firstFarmID(), oldName, oldRole).
		Updates(map[string]any{"name": user.Name, "role": user.Role}).Error; err != nil {
		log.Printf("users: syncing team row for %s: %v", user.Email, err)
	}
}

// firstFarmID is the single-farm deployment's id ("" when none).
func (a *API) firstFarmID() string {
	var farm models.Farm
	if err := a.DB.First(&farm).Error; err != nil {
		return ""
	}
	return farm.ID
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

type patchMeReq struct {
	Name         *string `json:"name"`
	Phone        *string `json:"phone"`
	TelegramChat *string `json:"telegramChat"`
}

// PATCH /api/v1/auth/me — any signed-in person edits their own display name
// and where their alerts are sent. Role and password have their own routes.
func (a *API) patchMe(c *gin.Context) {
	var req patchMeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	if err := contactError(deref(req.Phone), deref(req.TelegramChat)); err != nil {
		badRequest(c, err)
		return
	}
	if req.Name != nil && strings.TrimSpace(*req.Name) == "" {
		badRequest(c, errInvalid("name", "not empty"))
		return
	}
	// requireAuth's user is built from the token claims (no password hash, no
	// contacts): load the real row and write only the profile columns, never Save the claims copy
	var user models.User
	if err := a.DB.First(&user, "id = ?", currentUser(c).ID).Error; err != nil {
		unauthorized(c, "লগইন প্রয়োজন।")
		return
	}
	oldName := user.Name
	if req.Name != nil {
		user.Name = *req.Name
	}
	if req.Phone != nil {
		user.Phone = *req.Phone
	}
	if req.TelegramChat != nil {
		user.TelegramChat = *req.TelegramChat
	}
	if err := a.DB.Model(&user).Select("name", "phone", "telegram_chat").Updates(&user).Error; err != nil {
		serverError(c, err)
		return
	}
	a.syncTeamMember(user, oldName, user.Role)
	a.audit(c, "", "user.profile", user.Email)
	c.JSON(http.StatusOK, user)
}
