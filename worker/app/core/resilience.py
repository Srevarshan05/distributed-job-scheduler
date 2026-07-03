import asyncio
import random
import logging
from functools import wraps
from sqlalchemy.exc import OperationalError

logger = logging.getLogger("worker.resilience")

def retry_on_db_lock(max_retries: int = 5, base_delay: float = 0.05):
    """Decorator to retry database transactions when they encounter contention or locks.

    Catches sqlalchemy.exc.OperationalError and retries if the error message contains
    keywords like 'locked', 'deadlock', 'busy', or 'timeout' using jittered exponential backoff.
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            for attempt in range(max_retries):
                try:
                    return await func(*args, **kwargs)
                except OperationalError as e:
                    err_msg = str(e).lower()
                    is_lock_error = any(kw in err_msg for kw in ["locked", "deadlock", "busy", "timeout", "serialization"])
                    if is_lock_error:
                        if attempt == max_retries - 1:
                            logger.error("DB lock retry limit reached in %s: %s", func.__name__, e)
                            raise
                        delay = base_delay * (2 ** attempt) + random.uniform(0, 0.05)
                        logger.warning(
                            "DB contention/lock in %s, retrying in %.2fs (attempt %d/%d). Error: %s",
                            func.__name__, delay, attempt + 1, max_retries, e
                        )
                        await asyncio.sleep(delay)
                    else:
                        raise
        return wrapper
    return decorator
