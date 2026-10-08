# Sourced by bin/team-start and bin/team-resurrect (not run on its own).
#
# A claude that team-start or team-resurrect launches in a herdr pane loads only the
# installed plugin, which may lack this version's agents/team-<role>.md and mod:
# `--agent` then fails and `herdr agent start` times out. So the child gets the plugin
# the calling script came from. An installed copy (under <profile>/plugins/cache)
# loads by itself and needs no flag.
#
# Sets the array plugin_args: empty for an installed copy, else (--plugin-dir <root>).
# The root is this file's parent directory, which is the plugin root of the caller.
plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
plugin_args=()
profile_dir="$(cd "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" 2>/dev/null && pwd -P || true)"
case "$plugin_root" in
  "${profile_dir:-/nonexistent}"/plugins/cache/*) ;;
  *) plugin_args=(--plugin-dir "$plugin_root") ;;
esac
