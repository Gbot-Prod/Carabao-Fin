from pydantic import BaseModel

# CF-0059: upper bound for `offset` query params. Without one, an offset
# above 2**63 makes Postgres fail (500) and big offsets scan the table.
MAX_OFFSET = 10_000

# CF-0093: upper bound for `page` query params, for the same reason: the
# offset is computed from it ((page - 1) * page_size), so an unbounded page
# gave the same 500 (bigint out of range) and deep scans on public search.
MAX_PAGE = 10_000


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int
