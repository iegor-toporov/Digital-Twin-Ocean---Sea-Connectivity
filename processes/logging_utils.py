import logging
import os
import time

_ROOT    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_LOG_DIR = os.path.join(_ROOT, 'logs')

_LOG_FORMAT = '[%(asctime)s] {%(filename)s:%(lineno)d} %(levelname)s - %(message)s'
_DATE_FORMAT = '%Y-%m-%dT%H:%M:%S'
_MAX_LINES = 1000


class LineRotatingFileHandler(logging.FileHandler):
    """FileHandler that truncates the log file when it exceeds max_lines."""

    def __init__(self, filename, max_lines=_MAX_LINES):
        os.makedirs(os.path.dirname(os.path.abspath(filename)), exist_ok=True)
        super().__init__(filename, mode='a', encoding='utf-8', delay=False)
        self.max_lines = max_lines
        self._line_count = self._count_lines()

    def _count_lines(self):
        try:
            with open(self.baseFilename, 'r', encoding='utf-8', errors='ignore') as f:
                return sum(1 for _ in f)
        except FileNotFoundError:
            return 0

    def emit(self, record):
        if self._line_count >= self.max_lines:
            self._truncate()
        super().emit(record)
        self._line_count += 1

    def _truncate(self):
        self.acquire()
        try:
            if self.stream:
                self.stream.close()
            self.stream = open(self.baseFilename, 'w', encoding='utf-8')
            self._line_count = 0
        finally:
            self.release()


def setup_logger(name, subdir, filename, max_lines=_MAX_LINES):
    """Create (or retrieve) a logger writing to logs/<subdir>/<filename>."""
    log_path = os.path.join(_LOG_DIR, subdir, filename)
    log = logging.getLogger(name)
    if not log.handlers:
        fh = LineRotatingFileHandler(log_path, max_lines=max_lines)
        fmt = logging.Formatter(_LOG_FORMAT, datefmt=_DATE_FORMAT)
        fmt.converter = time.localtime
        fh.setFormatter(fmt)
        log.addHandler(fh)
        log.setLevel(logging.DEBUG)
        log.propagate = False
    return log
