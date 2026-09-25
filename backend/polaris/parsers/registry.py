from typing import List, Type
from polaris.parsers.base import BaseParser

class ParserRegistry:
    def __init__(self):
        self._parsers: List[BaseParser] = []

    def register(self, parser: BaseParser):
        self._parsers.append(parser)

    def auto_detect(self, filepath: str) -> BaseParser:
        for parser in self._parsers:
            if parser.can_parse(filepath):
                return parser
        raise ValueError(f"No parser found for: {filepath}")

    def parse(self, filepath: str, **kwargs):
        parser = self.auto_detect(filepath)
        return parser.parse(filepath, **kwargs)
