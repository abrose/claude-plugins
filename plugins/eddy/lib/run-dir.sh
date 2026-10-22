# Sourced by bin/eddy-init, bin/eddy-start, bin/eddy-resurrect, bin/eddy-orch-start,
# bin/eddy-slice, bin/eddy-brief, bin/eddy-forget and bin/eddy-status (not run on its own).
#
# The run dir is `$EDDY_SCRATCH`, default `.eddy-runs/current`. A relative value means "under
# the project root". It must not mean "under $PWD": a shell `cd` in the calling session moves
# $PWD, and the run would split into one run dir per directory the caller stood in.
#
# eddy_project_root  prints the main checkout of the caller: the parent of the common git dir
#                    (the same from a linked worktree), else the git top level, else $PWD.
# eddy_run_dir       prints the absolute, symlink-resolved run dir. An absolute EDDY_SCRATCH wins.
eddy_project_root() {
  local common top
  common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || common=""
  case "$common" in
    /*/.git) printf '%s\n' "${common%/.git}"; return 0 ;;
  esac
  top="$(git rev-parse --show-toplevel 2>/dev/null)" || top=""
  printf '%s\n' "${top:-$PWD}"
}

eddy_run_dir() {
  local scratch="${EDDY_SCRATCH:-.eddy-runs/current}"
  case "$scratch" in
    /*) ;;
    *) scratch="$(eddy_project_root)/$scratch" ;;
  esac
  python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$scratch"
}
