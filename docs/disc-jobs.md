# Usługa operacji dyskowych

`/usr/sbin/nimbus-disc-jobs` to osobny proces Python 3 (biblioteka standardowa,
bez pip), uruchamiany przez systemd. Go zachowuje logowanie, API i parsowanie
odpowiedzi dla istniejącego interfejsu. Worker wykonuje operacje dyskowe przez
lokalny socket `/run/nimbus/disc-jobs.sock`. Nie udostępnia dowolnej powłoki ani
portu TCP. Socket jest dostępny dla root i sprawdza SO_PEERCRED; odpowiada to
obecnej usłudze Nimbus działającej jako root.

## Instalacja

Pełny `sudo bash install.sh --update` instaluje worker razem z aplikacją.
`update.sh` również instaluje usługę, ale nadal wymaga przygotowanej binarki
Nimbusa i bundla, tak jak wcześniej. Przy ręcznej aktualizacji z repozytorium:

```bash
make
sudo bash services/disc-jobs/install.sh
# Zainstaluj nową binarkę i web/static zgodnie ze swoją obecną instalacją.
sudo systemctl restart nimbus
systemctl status nimbus-disc-jobs --no-pager
journalctl -u nimbus-disc-jobs -n 50 --no-pager
```

Potrzebne programy zależą od operacji: python3, util-linux, parted/partprobe,
smartmontools, narzędzia mkfs, zfsutils-linux, mdadm, lvm2 i ssacli/hpssacli na HP.
Brak programu daje błąd konkretnego zadania. Nie instalujemy ani nie zmieniamy
konfiguracji kontrolera Smart Array.

Historia SQLite WAL i kopie FSTAB: `/var/lib/nimbus/disc-jobs/` (root-only).
Przestrzeń konfiguracji nowej usługi: `/etc/nimbus/`; worker nie używa
`/etc/nas-panel/`. Jednostka nie tworzy prywatnej przestrzeni montowań: mount
musi być widoczny na hoście. Nie należy dodawać do niej opcji systemd, które
izolują montowania (np. PrivateTmp, PrivateDevices, ProtectSystem, ProtectHome).
Instalator najpierw wstrzymuje przyjmowanie nowych zadań; odmawia restartu usługi,
jeżeli istnieją zadania oczekujące lub wykonywane.

## Co zostało przeniesione

- Formatowanie ext2/3/4, XFS, Btrfs, FAT, exFAT, NTFS oraz tworzenie puli ZFS.
- Tworzenie/usuwanie partycji na **istniejącej tablicy GPT**. Bez automatycznego
  zastępowania tablicy partycji i bez zmiany rozmiaru istniejącego systemu plików.
- Montowanie, odmontowanie, FSTAB: przełącznik, weryfikacja, zapis i zastosowanie.
- Tworzenie ZFS/MD RAID/LVM, scrub, eksport, migawki, rollback i clone.
- Skanowanie dysków/RAID/LVM oraz uruchamianie testów SMART.
- Odczyty lsblk, SMART, ssacli/hpssacli, właściwości/listy ZFS, I/O ZFS i LVM.
  Cache: 5 s dla typowych odczytów, 60 s dla SMART/kontrolera.

Go nadal czyta lekkie dane z /proc i statfs, mapuje dane do widoków, zarządza
smartd i dotychczasowym harmonogramem automatycznych migawek. Istniejący ogólny
endpoint exec-command wykorzystywany także przez inne moduły nie został usunięty;
nie jest częścią protokołu workera. Nie oznacza to jeszcze przeniesienia każdego
narzędzia administracyjnego Nimbusa do Pythona.

## Zadania i ograniczenia

`POST /api/storage/jobs` przyjmuje JSON z `operation` i parametrami.
Dotychczasowe endpointy mutacji Storage oraz ZFS również zwracają **202** i zadanie.
`GET /api/storage/jobs` zwraca ostatnich 200 wpisów; starsze pozostają w SQLite.
`GET /api/storage/jobs/{id}` pokazuje etap i wynik, a `/api/storage/jobs-health`
sprawdza usługę. Frontend oczekuje na wynik przez krótkie zapytania co 1,5 s;
zakładka **Zadania** odświeża się co 3 s. Po zmianie odpowiedni cache Go jest
unieważniany. Nie ma fikcyjnego procentu wykonania mkfs: pokazywany jest etap.
Scrub, test SMART i synchronizacja RAID kończą zadanie, gdy narzędzie potwierdzi
ich uruchomienie; proces sprzętowy może nadal trwać.

Nagłówek `Idempotency-Key` (32 znaki hex albo UUID) identyfikuje jedno żądanie.
Ponowienie identycznego żądania z tym samym kluczem zwraca tę samą operację;
inny payload z tym kluczem jest odrzucany. Klucz zachowaj przy utracie odpowiedzi.
Go zwraca także `X-Nimbus-Job-ID` i, przy przyjęciu, `Location`.
Usługa nie ponawia automatycznie operacji przerwanych przez restart: oznacza je
jako `interrupted`. Nie ma anulowania działającego mkfs ani automatycznego rollbacku.

Konserwatywnie wykonywana jest jedna operacja sprzętowa naraz. Odczyty w czasie
jej trwania zwracają informację o zajętości; historia i API zadań nadal działają.
Nowe zadania dyskowe mogą czekać w kolejce. Zlecenie operacji na puli wymaga
odczytu jej GUID i może zostać odrzucone jako zajęte podczas innej operacji.

Tożsamość dysku jest wiązana z WWN/serial, rozmiarem, typem, początkiem partycji
i dostępnym by-id; po wyjęciu/podmianie urządzenia zadanie jest odrzucane.
Bez WWN/serial nie wykonujemy operacji na dysku. Przed zapisem sprawdzane są
montowania, dysk systemowy, swap, podpisy ZFS/RAID/LVM/LUKS, holders i aktywne
pule ZFS. Nowe montowania tworzone są w /mnt; istniejące niesystemowe montowania
można odmontować lub zapisać w FSTAB także poza /mnt. Identyfikator aktywnego
montowania jest ponownie porównywany przed odmontowaniem.

FSTAB wymaga zgodności z oryginalną treścią, jest sprawdzany przez findmnt,
zapisywany atomowo z kopią i fsync. Błąd `mount -a` po zapisie pozostaje widoczny
z `saved: true` i `applied: false`. Edycja poza Nimbusem nie jest blokowana;
porównanie treści ogranicza możliwość nadpisania równoległych zmian.

Plan partycjonowania jest lokalny do chwili zastosowania. Frontend zleca jego
operacje kolejno i zatrzymuje się na pierwszym błędzie. Po przeładowaniu strony
w historii pozostają przyjęte zadania; niezlecone kroki nie zostaną wykonane.
Pula systemowa jest chroniona przed eksportem, systemowy dataset przed rollbackiem.
Worker nie wymusza `zpool create -f` ani `zfs rollback -r`; odmowa narzędzia jest
wyświetlana użytkownikowi. Szyfrowanie nowej puli wymaga odrębnego mechanizmu kluczy
— zaznaczone szyfrowanie jest odrzucane, a nie pomijane.

## Weryfikacja

```bash
python3 -m unittest discover -s tests -p '*_test.py' -v
node --test tests/*.test.cjs
go test ./...
go test -race ./internal/api ./internal/sys
go build ./cmd/nimbus ./cmd/nimbus-dl
```

W środowisku wykonania zmian: 16 testów Python i 32 JS przeszły, frontend się
buduje. Integracyjny test socketu jest do uruchomienia na hoście (tutaj tworzenie
socketu jest zabronione); testy/build Go również pozostają do wykonania z powodu
braku kompilatora. Testy Python używają podstawionych poleceń i nie formatują
rzeczywistych dysków. Nie wykonano testu na HP Smart Array ani montowania na hoście.
