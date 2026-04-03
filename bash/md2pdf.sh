#!/bin/bash
set -euo pipefail

# Render Mermaid diagrams and convert Markdown to PDF via npx md-to-pdf.
# Uses @mermaid-js/mermaid-cli (mmdc) directly on Markdown: it extracts ```mermaid```
# fences, writes SVGs, and rewrites the Markdown to reference those SVGs.
# Pipeline:
#   1) mmdc -i <src.md> -o <temp/converted.md>  (SVGs land next to converted.md)
#   2) md-to-pdf converted.md (basedir=temp)

usage() {
  cat <<'EOF'
Usage: md_pdf_mermaid.sh [-s pdf.css] [-o output_dir] [-r temp_root | -p] [-k] file1.md [file2.md ...]
Options:
  -s <file>   Stylesheet passed to md-to-pdf (--stylesheet). Defaults to css/default.css.
  -o <dir>    Output directory for PDFs (default: alongside each input file).
  -r <dir>    Root directory for temp work dirs (default: system temp).
  -p          Place temp dir inside the output directory (or source dir if -o is absent).
  -k          Keep temp working directory (prints its path).
  -h          Show this help.
EOF
}

STYLESHEET=""
OUTPUT_DIR=""
KEEP_TEMP=false
TEMP_ROOT=""
TEMP_IN_OUTPUT=false

while getopts ":s:o:r:pkh" opt; do
  case "$opt" in
    s) STYLESHEET="$OPTARG" ;;
    o) OUTPUT_DIR="$OPTARG" ;;
    r) TEMP_ROOT="$OPTARG" ;;
    p) TEMP_IN_OUTPUT=true ;;
    k) KEEP_TEMP=true ;;
    h)
      usage
      exit 0
      ;;
    :)
      echo "Option -$OPTARG requires an argument."
      usage
      exit 1
      ;;
    \?)
      echo "Invalid option: -$OPTARG"
      usage
      exit 1
      ;;
  esac
done
shift $((OPTIND - 1))

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

if [[ -z "$STYLESHEET" ]]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  default_stylesheet="$script_dir/../css/default.css"
  if [[ -f "$default_stylesheet" ]]; then
    STYLESHEET="$default_stylesheet"
  fi
fi

if [[ -n "$STYLESHEET" && ! -f "$STYLESHEET" ]]; then
  echo "Stylesheet not found: $STYLESHEET"
  exit 1
fi

convert_file() {
  local src="$1"
  if [[ ! -f "$src" ]]; then
    echo "File not found: $src"
    return 1
  fi

  local abs_src base_name stem workdir converted_md target_dir out_pdf temp_pdf
  abs_src="$(cd "$(dirname "$src")" && pwd)/$(basename "$src")"
  base_name="$(basename "$src")"
  stem="${base_name%.*}"

  if $TEMP_IN_OUTPUT; then
    local base_out
    if [[ -n "$OUTPUT_DIR" ]]; then
      base_out="$OUTPUT_DIR"
    else
      base_out="$(cd "$(dirname "$src")" && pwd)"
    fi
    mkdir -p "$base_out"
    workdir="$(mktemp -d "$base_out/${stem}.XXXX")"
  elif [[ -n "$TEMP_ROOT" ]]; then
    mkdir -p "$TEMP_ROOT"
    workdir="$(mktemp -d "$TEMP_ROOT/${stem}.XXXX")"
  else
    workdir="$(mktemp -d)"
  fi

  converted_md="$workdir/${stem}_converted.md"

  # Mermaid CLI handles extraction + SVG generation in one pass.
  npx @mermaid-js/mermaid-cli -i "$abs_src" -o "$converted_md"

  if [[ -n "$OUTPUT_DIR" ]]; then
    target_dir="$OUTPUT_DIR"
  else
    target_dir="$(cd "$(dirname "$src")" && pwd)"
  fi
  mkdir -p "$target_dir"

  # md-to-pdf writes next to the input markdown by default.
  temp_pdf="${converted_md%.md}.pdf"
  out_pdf="$target_dir/$stem.pdf"
  cmd=(npx md-to-pdf "$converted_md" --basedir "$workdir")
  [[ -n "$STYLESHEET" ]] && cmd+=(--stylesheet "$STYLESHEET")
  "${cmd[@]}"

  cp "$temp_pdf" "$out_pdf"

  if $KEEP_TEMP; then
    echo "Temp kept at: $workdir"
  else
    rm -rf "$workdir"
  fi

  echo "Created: $out_pdf"
}

for file in "$@"; do
  convert_file "$file"
done

exit 0
