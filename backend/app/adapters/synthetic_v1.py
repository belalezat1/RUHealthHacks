from app.schemas.events import Dataset


class SyntheticV1Adapter:
    def parse(self, payload):
        return Dataset.model_validate(payload)
