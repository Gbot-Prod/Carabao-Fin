from pydantic import BaseModel

# CF-0059: upper bound for `offset` query params. Without one, an offset
# above 2**63 makes Postgres fail (500) and big offsets scan the table.
MAX_OFFSET = 10_000

# CF-0093: upper bound for `page` query params, for the same reason: the
# offset is computed from it ((page - 1) * page_size), so an unbounded page
# gave the same 500 (bigint out of range) and deep scans on public search.
MAX_PAGE = 10_000

# CF-0094 (B102): upper bound for id filters in query params (merchant_id,
# admin_id, target_id, after_id). The id columns are Postgres `integer`, so
# no row has a larger id; a bound keeps odd values out of the SQL.
MAX_ID = 2**31 - 1

# CF-0094 (B102): upper bound for free-text filters with no other limit.
MAX_FILTER_TEXT = 100


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int
