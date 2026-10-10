"""TypeSafe HTTP shapes and request-aware validation; no model output grants authority."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Probability = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False, strict=True)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NoulQuestion(StrictModel):
    type: Literal["noul"] = "noul"
    instructions: str
    criteria: dict[Literal["true", "false"], str] | None = None


class ChoiceQuestion(StrictModel):
    type: Literal["choice"] = "choice"
    instructions: str
    criteria: dict[str, str] = Field(min_length=2, max_length=8)


class ScoreQuestion(StrictModel):
    type: Literal["score"] = "score"
    instructions: str
    criteria: list[str] = Field(min_length=2, max_length=10)


Question = Annotated[NoulQuestion | ChoiceQuestion | ScoreQuestion, Field(discriminator="type")]


class JevRequest(StrictModel):
    state: dict[str, Any]
    model: str = Field(min_length=1)
    questions: dict[str, Question] = Field(min_length=1, max_length=8)


class NoulAnswer(StrictModel):
    type: Literal["noul"]
    noul: Probability


class ChoiceAnswer(StrictModel):
    type: Literal["choice"]
    choice: str
    confidence: Probability
    probabilities: dict[str, Probability]


class ScoreAnswer(StrictModel):
    type: Literal["score"]
    score: Annotated[float, Field(ge=0, allow_inf_nan=False, strict=True)]
    confidence: Probability
    legend: dict[str, str]
    probabilities: dict[str, Probability]


Answer = Annotated[NoulAnswer | ChoiceAnswer | ScoreAnswer, Field(discriminator="type")]


class Usage(StrictModel):
    input_tokens: int = Field(ge=0, strict=True)
    output_tokens: int = Field(ge=0, strict=True)


class JevResponse(StrictModel):
    model: str = Field(min_length=1)
    answers: dict[str, Answer]
    usage: Usage

    @model_validator(mode="after")
    def distributions_sum_to_one(self):
        for answer in self.answers.values():
            if isinstance(answer, (ChoiceAnswer, ScoreAnswer)):
                if abs(sum(answer.probabilities.values()) - 1) > 0.01:
                    raise ValueError("probabilities must sum to approximately one")
        return self


def validate_response(payload: Any, request: JevRequest) -> JevResponse:
    """Validate coverage and all rubric semantics against the actual submitted questions."""
    response = JevResponse.model_validate(payload)
    if set(response.answers) != set(request.questions):
        raise ValueError("answer names must exactly match requested questions")
    for name, question in request.questions.items():
        answer = response.answers[name]
        if answer.type != question.type:
            raise ValueError(f"{name}: question and answer types differ")
        if isinstance(question, ChoiceQuestion) and isinstance(answer, ChoiceAnswer):
            if set(answer.probabilities) != set(question.criteria):
                raise ValueError(f"{name}: unknown or missing choice/candidate")
            if answer.choice not in question.criteria:
                raise ValueError(f"{name}: unknown selected choice/candidate")
            if answer.probabilities[answer.choice] + 0.001 < max(answer.probabilities.values()):
                raise ValueError(f"{name}: selected choice is not a highest probability choice")
        if isinstance(question, ScoreQuestion) and isinstance(answer, ScoreAnswer):
            legend = {str(index): value for index, value in enumerate(question.criteria)}
            if answer.legend != legend or set(answer.probabilities) != set(legend):
                raise ValueError(f"{name}: incompatible score legend or indices")
            if answer.score > len(question.criteria) - 1:
                raise ValueError(f"{name}: score outside rubric")
            expected_score = sum(int(key) * value for key, value in answer.probabilities.items())
            if abs(answer.score - expected_score) > 0.02:
                raise ValueError(f"{name}: score must be the probability-weighted rubric index")
    return response


class AdvisoryResult(StrictModel):
    provider: str = "typesafe"
    mode: Literal["off", "mock", "live"]
    status: Literal["disabled", "mock", "available", "unavailable", "invalid", "uncertain", "stale", "not_requested"]
    model: str
    requested_model: str | None = None
    answers: dict[str, Any] = Field(default_factory=dict)
    usage: dict[str, int] = Field(default_factory=dict)
    latency_ms: float = 0
    input_version: int | None = None
    dataset_id: str | None = None
    proposal_id: str | None = None
    rubric_version: str = "operations-handoff-v1"
    as_of: str | None = None
    valid_until: str | None = None
    uncertain: bool = False
    uncertainty_reasons: list[str] = Field(default_factory=list)
    message: str
