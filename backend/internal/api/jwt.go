// Access tokens are JWTs (HS256) so requireAuth never touches the database;
// the paired refresh token (auth.go) is what lives in the sessions table and
// what logout revokes.
package api

import (
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/farm-command/backend/internal/models"
)

// accessTTL is kept short: a leaked access token stops working quickly, and
// clients refresh transparently anyway.
const accessTTL = 15 * time.Minute

// accessClaims carries the user's identity and role so requireAuth and the
// role checks need no DB round-trip; sub is the user id.
type accessClaims struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
	jwt.RegisteredClaims
}

// signAccess returns a signed JWT for the user.
func signAccess(user *models.User, secret []byte) (string, error) {
	now := time.Now()
	claims := accessClaims{
		Name:  user.Name,
		Email: user.Email,
		Role:  user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(accessTTL)),
			Issuer:    "farm-command",
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
}

// verifyAccess checks the signature and expiry and returns the claims.
func verifyAccess(tokenStr string, secret []byte) (*accessClaims, error) {
	claims := &accessClaims{}
	_, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
		return secret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		return nil, err
	}
	return claims, nil
}

// userFromClaims rebuilds the request-scoped user; fields the JWT doesn't
// carry (password hash, timestamps) stay zero — handlers never need them.
func userFromClaims(claims *accessClaims) *models.User {
	return &models.User{ID: claims.Subject, Name: claims.Name, Email: claims.Email, Role: claims.Role}
}
