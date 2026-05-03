# ╔══════════════════════════════════════════════════════════╗
# ║  Nimbus NAS — Makefile                                   ║
# ╚══════════════════════════════════════════════════════════╝

BINARY   := nimbus
CMD      := ./cmd/nimbus
STATIC   := web/static
ENTRY    := $(STATIC)/entry.jsx
BUNDLE   := $(STATIC)/bundle.js
JSX      := $(wildcard $(STATIC)/*.jsx)
VERSION  := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS  := -ldflags "-X main.version=$(VERSION) -s -w"
CGO      := CGO_ENABLED=1

.PHONY: all build js go dev watch run clean install-tools fmt lint help

# ── Domyślny target ───────────────────────────────────────────────────────────
all: js go ## Zbuduj JS + binarke Go (produkcja)

# ── JavaScript ────────────────────────────────────────────────────────────────
js: $(BUNDLE) ## Skompiluj JSX → bundle.js (produkcja, minifikacja)

$(BUNDLE): $(JSX) $(ENTRY)
	@printf "📦  JSX → bundle.js … "
	@esbuild $(ENTRY) \
		--bundle \
		--minify \
		--platform=browser \
		--target=es2020 \
		--jsx=transform \
		--jsx-factory=React.createElement \
		--jsx-fragment=React.Fragment \
		--loader:.jsx=jsx \
		--external:react \
		--external:react-dom \
		--define:process.env.NODE_ENV='"production"' \
		--outfile=$(BUNDLE)
	@SIZE=$$(wc -c < $(BUNDLE)); \
	 printf "✓  %s KB\n" $$(( SIZE / 1024 ))
	@gzip -9 -k -f $(BUNDLE)
	@gzip -9 -k -f $(STATIC)/styles.css
	@printf "✓  gzip: bundle.js.gz + styles.css.gz\n"

js-dev: ## Skompiluj JSX z source mapami (development)
	@printf "🔧  JSX dev build … "
	@esbuild $(ENTRY) \
		--bundle \
		--sourcemap \
		--platform=browser \
		--target=es2020 \
		--jsx=transform \
		--jsx-factory=React.createElement \
		--jsx-fragment=React.Fragment \
		--loader:.jsx=jsx \
		--external:react \
		--external:react-dom \
		--define:process.env.NODE_ENV='"development"' \
		--outfile=$(BUNDLE)
	@printf "✓  $(BUNDLE) + $(BUNDLE).map\n"

watch: ## Nasłuchuj zmian JSX i przebudowuj automatycznie
	@echo "👁   Watch mode — Ctrl+C aby zatrzymać"
	@esbuild $(ENTRY) \
		--bundle \
		--sourcemap \
		--platform=browser \
		--target=es2020 \
		--jsx=transform \
		--jsx-factory=React.createElement \
		--jsx-fragment=React.Fragment \
		--loader:.jsx=jsx \
		--external:react \
		--external:react-dom \
		--define:process.env.NODE_ENV='"development"' \
		--outfile=$(BUNDLE) \
		--watch

# ── Go ────────────────────────────────────────────────────────────────────────
go: ## Skompiluj binarke Go
	@printf "🔨  Go build (v$(VERSION)) … "
	@$(CGO) go build $(LDFLAGS) -o $(BINARY) $(CMD)
	@printf "✓  ./$(BINARY)\n"

go-race: ## Skompiluj z detektorem race condition
	@$(CGO) go build -race $(LDFLAGS) -o $(BINARY)-race $(CMD)

# ── Uruchamianie ──────────────────────────────────────────────────────────────
dev: js-dev go ## Dev build + uruchom serwer
	./$(BINARY)

run: go ## Skompiluj Go i uruchom
	./$(BINARY)

run-web: ## Uruchom z niestandardowym katalogiem web
	./$(BINARY) -web $(STATIC)

# ── Testy ─────────────────────────────────────────────────────────────────────
test: ## Uruchom testy Go
	$(CGO) go test ./...

test-verbose: ## Testy z wyjściem verbose
	$(CGO) go test -v ./...

# ── Jakość kodu ───────────────────────────────────────────────────────────────
fmt: ## Formatuj kod Go
	gofmt -w ./...
	@echo "✓  gofmt"

lint: ## Sprawdź kod Go (wymaga golangci-lint)
	golangci-lint run ./...

vet: ## go vet
	$(CGO) go vet ./...

# ── Instalacja narzędzi ───────────────────────────────────────────────────────
install-tools: ## Zainstaluj esbuild i inne narzędzia
	@echo "📥  Instalacja esbuild…"
	go install github.com/evanw/esbuild/cmd/esbuild@latest
	@echo "✓  esbuild: $$(esbuild --version)"

# ── Dystrybucja ───────────────────────────────────────────────────────────────
dist: js go ## Zbuduj paczkę do dystrybucji (tar.gz)
	@mkdir -p dist/nimbus
	@cp $(BINARY) dist/nimbus/
	@cp -r web dist/nimbus/
	@cp README.md dist/nimbus/ 2>/dev/null || true
	@tar -czf dist/nimbus-$(VERSION)-linux-amd64.tar.gz -C dist nimbus
	@rm -rf dist/nimbus
	@echo "✓  dist/nimbus-$(VERSION)-linux-amd64.tar.gz"

# ── Czyszczenie ───────────────────────────────────────────────────────────────
clean: ## Usuń artefakty budowania
	rm -f $(BINARY) $(BINARY)-race $(BUNDLE) $(BUNDLE).map
	rm -rf dist/
	@echo "✓  Wyczyszczono"

# ── Pomoc ─────────────────────────────────────────────────────────────────────
help: ## Wyświetl tę pomoc
	@echo ""
	@echo "  Nimbus NAS — system budowania"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""

.DEFAULT_GOAL := help
