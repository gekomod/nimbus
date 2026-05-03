package main

import (
	"flag"
	"fmt"
	"log"
	"nimbus/internal/api"
	"nimbus/internal/auth"
	"os"
	"runtime"
	"runtime/debug"
)

var version = "dev" // nadpisywane przez -ldflags w Makefile

func main() {
	port   := flag.Int("port", 80, "Port HTTP")
	webDir := flag.String("web", "./web/static", "Katalog z frontendem")

	// Fallback — używany gdy PAM zawiedzie lub serwer startuje w kontenerze.
	// W normalnym trybie PAM każdy użytkownik systemu Linux może się zalogować
	// swoim hasłem systemowym (/etc/shadow, LDAP, AD itp.)
	fallbackUser := flag.String("user", "admin", "Lokalny admin (fallback gdy PAM niedostępny)")
	fallbackPass := flag.String("pass", "",      "Hasło fallback (puste = generuj losowo)")

	flag.Parse()

	password := *fallbackPass
	if password == "" {
		password = auth.GenPassword(16)

		fmt.Fprintf(os.Stderr, "\n╔══════════════════════════════════════════════════╗\n")
		fmt.Fprintf(os.Stderr,   "║  Nimbus NAS — Panel administracyjny  %8s  ║\n", version)
		fmt.Fprintf(os.Stderr,   "╠══════════════════════════════════════════════════╣\n")
		fmt.Fprintf(os.Stderr,   "║  Tryb auth:   PAM (/etc/pam.d/login)            ║\n")
		fmt.Fprintf(os.Stderr,   "║  → Zaloguj się używając konta systemowego Linux  ║\n")
		fmt.Fprintf(os.Stderr,   "╠══════════════════════════════════════════════════╣\n")
		fmt.Fprintf(os.Stderr,   "║  Fallback:    %-32s║\n", *fallbackUser)
		fmt.Fprintf(os.Stderr,   "║  Hasło:       %-32s║\n", password)
		fmt.Fprintf(os.Stderr,   "╚══════════════════════════════════════════════════╝\n")
		fmt.Fprintf(os.Stderr,   "  http://localhost:%d\n\n", *port)
	}

	// Ogranicz liczbę wątków OS — domyślnie Go używa liczby CPU
	// ale przy wielu blokujących syscallach może tworzyć zbyt wiele wątków
	runtime.GOMAXPROCS(runtime.NumCPU())

	// Agresywniejszy GC — zwalniaj pamięć szybciej
	debug.SetGCPercent(50)

	srv := api.NewServer(api.Config{
		Port:         *port,
		WebDir:       *webDir,
		FallbackUser: *fallbackUser,
		FallbackPass: password,
	})

	log.Printf("Nimbus %s — nasłuchuję na :%d (auth: PAM)", version, *port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
