#!/usr/bin/env python3
"""Uruchom z katalogu nimbus: python3 fix_compile.py"""
import re

print("=== Naprawa błędów kompilacji ===\n")

# ── 1. totp.go: currentUser - zła składnia ───────────────────────────────────
try:
    with open('internal/api/totp.go') as f:
        src = f.read()

    # Znajdź funkcję currentUser i zastąp całą jej zawartość
    new = re.sub(
        r'(func \(s \*Server\) currentUser\(r \*http\.Request\) string \{)[^}]*(})',
        r'\1\n\ttoken := tokenFromRequest(r)\n\tif !s.auth.Valid(token) { return "" }\n\treturn s.auth.SessionUser(token)\n\2',
        src
    )
    if new != src:
        with open('internal/api/totp.go', 'w') as f:
            f.write(new)
        print("✓  totp.go: currentUser naprawiony")
    else:
        print("✗  totp.go: nie naprawiono automatycznie")
        print("   Znajdź funkcję currentUser i zamień jej ciało na:")
        print('   token := tokenFromRequest(r)')
        print('   if !s.auth.Valid(token) { return "" }')
        print('   return s.auth.SessionUser(token)')
except Exception as e:
    print(f"✗  totp.go: {e}")

# ── 2. server.go: req2fa unused ──────────────────────────────────────────────
try:
    with open('internal/api/server.go') as f:
        src = f.read()

    # Usuń deklarację var req2fa struct {...} i komentarze obok niej
    new = re.sub(
        r'\n\t\tvar req2fa struct \{[^}]+\}\n\t\t// [^\n]*\n\t\t// [^\n]*\n',
        '\n',
        src
    )
    # Fallback — tylko var req2fa struct
    if new == src:
        new = re.sub(
            r'\n\t\tvar req2fa struct \{[^}]+\}\n',
            '\n',
            src
        )

    if new != src:
        with open('internal/api/server.go', 'w') as f:
            f.write(new)
        print("✓  server.go: req2fa struct usunięty")
    else:
        # Ostatnia próba — zamień req2fa na _ żeby kompilator nie narzekał
        new = src.replace('var req2fa struct', 'var _ struct')
        if new != src:
            with open('internal/api/server.go', 'w') as f:
                f.write(new)
            print("✓  server.go: req2fa → _ (suppress unused)")
        else:
            print("✗  server.go: nie naprawiono automatycznie")
            print("   Usuń lub zakomentuj blok 'var req2fa struct { ... }'")
except Exception as e:
    print(f"✗  server.go: {e}")

print("\n=== Gotowe. Uruchom: make all ===")
