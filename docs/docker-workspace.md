# Docker workspace

Widok **Aplikacje** odczytuje rzeczywisty stan silnika Docker. Kontenery można
filtrować, wyszukiwać i grupować według etykiety projektu Compose lub kategorii
rozpoznawanej z nazwy obrazu. Kategorie służą wyłącznie do porządkowania widoku.

Kliknięcie nazwy otwiera szczegóły: stan, healthcheck, historię CPU z bieżącej
sesji, logi, terminal, limity zasobów, zmienne środowiskowe, montowania i sieci.
Logi są odświeżane co 3 sekundy, lista co 8 sekund. Ukryta karta przeglądarki
wstrzymuje okresowe odczyty. Brak lub przedawnienie pomiaru jest oznaczane kreską.

Terminal używa `docker exec -it` przez istniejący uwierzytelniany endpoint PTY.
Wybrany obraz musi zawierać `/bin/sh` lub `/bin/bash`; biblioteki xterm są ładowane
z CDN tak jak w terminalu systemowym Nimbus.

Zmiany limitów i polityki restartu stosują `docker update`. Zmienne, obraz i
montowania można obejrzeć; ich zmiana wymaga odtworzenia kontenera. Dla projektu
Compose należy zmienić YAML. Limity zmienione w działającym kontenerze należy
również zapisać w YAML, aby przetrwały kolejne wdrożenie.

**Projekty Compose** wymagają wtyczki `docker compose`. Panel wykrywa projekty
silnika oraz pliki Compose w `/opt/stacks`, `/srv`, `/home` i `/root` do ograniczonej
głębokości. Edycja zachowuje lokalizację istniejącego pliku. Nowe projekty trafiają
do `/opt/stacks/<nazwa>/docker-compose.yml`.

Walidacja odbywa się w katalogu projektu, aby zachować ścieżki względne i `.env`.
Przed zapisem można porównać dotychczasowy i nowy YAML. Zapis jest atomowy;
nieudane wdrożenie po zapisie zwraca osobno informację o zapisanym pliku.
Wdrożenie pokazuje bieżącą fazę i końcowy komunikat Compose, bez fikcyjnego
procentu postępu. Projekty z kilkoma plikami zachowują kolejność plików podczas
uruchamiania i zatrzymywania; ich edycja pozostaje na hoście.

Usunięcie kontenera jest dostępne po jego zatrzymaniu i wymaga potwierdzenia.
Nie usuwa wolumenów ani katalogów hosta. Przycisk zatrzymania projektu używa
`docker compose stop`, zachowując kontenery i dane.

## Weryfikacja

- `npm ci` i `PATH="$PWD/node_modules/.bin:$PATH" make js` — kompilacja interfejsu.
- `node --test tests/docker-workspace.test.cjs` — kontrakty stanów, linków i błędów API.
- `go test ./...` — testy backendu; środowisko musi mieć Go i nagłówki PAM.
- Na hoście z Dockerem: sprawdzić start/stop/restart, błąd operacji, healthcheck,
  logi z pauzą, terminal, zapis limitów, montowania i nieudane wdrożenie Compose.
- W przeglądarce sprawdzić ciemny/jasny motyw, listę/kafelki oraz szerokość mobilną.
