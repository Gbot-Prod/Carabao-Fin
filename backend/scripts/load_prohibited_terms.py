"""Load the guardrail word list into prohibited_terms (produce guardrails Phase 1).

    uv run python scripts/load_prohibited_terms.py [--file PATH] [--dry-run]
        [--hard 3-457] [--profanity 458-630] [--soft-start 632]

Without --file it reads documentation/plans/carabao_produce_guardrail_wordlist.md
(or the copy in documentation/manuals). The line ranges set the severity
(app/services/term_list.py). Words already in the table are left as they are,
so an admin's changes stay. Run it again after the list grows.

The output is counts only: the list has offensive words, and this script never
prints a word. Use --dry-run first to see the counts without a write.
"""

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
load_dotenv(BACKEND_ROOT / ".env")

from app.services import term_list  # noqa: E402


def _range(text: str) -> tuple[int, int]:
    start, _, end = text.partition("-")
    return int(start), int(end or start)


def _print_counts(title: str, counts: dict[tuple[str, str], int]) -> None:
    print(title)
    if not counts:
        print("  (none)")
    for (category, severity), n in sorted(counts.items()):
        print(f"  {category:<22} {severity:<11} {n:>5}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--file", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--hard", type=_range, default=(3, 457))
    parser.add_argument("--profanity", type=_range, default=(458, 630))
    parser.add_argument("--soft-start", type=int, default=632)
    args = parser.parse_args()

    path: Path = args.file or term_list.default_file()
    if not path.exists():
        sys.exit(f"Word list not found: {path}")
    ranges = term_list.Ranges(
        hard=args.hard, profanity=args.profanity, soft_start=args.soft_start
    )
    report = term_list.parse(path.read_text(encoding="utf-8"), ranges)
    print(f"Read {report.lines_read} lines from {path.name}")
    _print_counts("Terms found (category, severity, count):", dict(report.counts()))
    print(f"Lines with no term (prose, headings, patterns): {report.skipped_lines}")
    if args.dry_run:
        print("Dry run: nothing written.")
        return

    from app.core.database import SessionLocal

    with SessionLocal() as db:
        result = term_list.load(db, report)
    _print_counts("Added:", dict(result.added))
    print(f"Already in the table (not changed): {result.already_present}")


if __name__ == "__main__":
    main()
