#!/bin/bash
# Reinstala plugins e skills do Claude Code em containers remotos efêmeros.
set -uo pipefail

# Só roda no Claude Code on the web (container remoto)
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

SKILLS_DIR="$HOME/.claude/skills"
mkdir -p "$SKILLS_DIR"

# --- Plugins (marketplaces oficiais da Anthropic) ---
claude plugin marketplace add anthropics/claude-code >/dev/null 2>&1 || true
claude plugin marketplace add anthropics/claude-plugins-official >/dev/null 2>&1 || true
claude plugin install frontend-design@claude-code-plugins >/dev/null 2>&1 || true
claude plugin install context7@claude-plugins-official >/dev/null 2>&1 || true
claude plugin install vercel@claude-plugins-official >/dev/null 2>&1 || true

# --- Skill: humanizer ---
if [ ! -d "$SKILLS_DIR/humanizer" ]; then
  git clone --depth 1 https://github.com/blader/humanizer.git "$SKILLS_DIR/humanizer" || true
fi

# --- Skill: brand-guidelines (do repo anthropics/skills) ---
if [ ! -d "$SKILLS_DIR/brand-guidelines" ]; then
  tmp="$(mktemp -d)"
  if git clone --depth 1 --filter=blob:none --sparse https://github.com/anthropics/skills.git "$tmp"; then
    git -C "$tmp" sparse-checkout set skills/brand-guidelines
    cp -r "$tmp/skills/brand-guidelines" "$SKILLS_DIR/brand-guidelines"
  fi
  rm -rf "$tmp"
fi

# --- Skills: gstack (coleção + setup) ---
if [ ! -d "$SKILLS_DIR/gstack" ]; then
  if git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git "$SKILLS_DIR/gstack"; then
    (cd "$SKILLS_DIR/gstack" && ./setup) \
      || echo "aviso: ./setup do gstack falhou; skills clonadas mas não registradas" >&2
  fi
fi

echo "session-start: plugins e skills verificados/instalados"
exit 0
