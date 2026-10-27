"""Request models for entering suppliers in the cockpit and controlling the auto mode."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


class YearFigures(BaseModel):
    year: int = Field(ge=1990, le=2100)
    revenue: float = Field(gt=0, description="Umsatz des Lieferanten, Mio. €")
    purchase: float = Field(ge=0, description="Einkaufsvolumen des Abnehmers beim Lieferanten, Mio. €")


class SupplierFigures(BaseModel):
    """Key figures a buyer can enter by hand. Everything is optional."""

    years: list[YearFigures] = []
    plan_next_year: float | None = Field(default=None, ge=0, description="Geplantes Einkaufsvolumen Folgejahr, Mio. €")
    pd_current: float | None = Field(default=None, ge=0, le=100)
    pd_current_date: date | None = None
    pd_previous: float | None = Field(default=None, ge=0, le=100)
    pd_previous_date: date | None = None
    ppm_current: float | None = Field(default=None, ge=0)
    ppm_previous: float | None = Field(default=None, ge=0)
    otd: float | None = Field(default=None, ge=0, le=100, description="Liefertreue in %")

    def to_internal(self) -> dict:
        """Converts the form input into the Internal Module dataset."""
        years = sorted(self.years, key=lambda y: y.year)
        data: dict = {
            "as_of": "",
            "revenue": {str(y.year): y.revenue for y in years},
            "purchase": {str(y.year): y.purchase for y in years},
            "plan_snapshots": [],
            "pd_history": [],
            "quality": {},
        }
        today = date.today()
        if years and self.plan_next_year is not None:
            data["plan_snapshots"] = [
                {"date": f"{today.year}-Q{(today.month - 1) // 3 + 1}", "volumes": {str(years[-1].year + 1): self.plan_next_year}}
            ]
        if self.pd_previous is not None:
            d = self.pd_previous_date or today.replace(year=today.year - 1)
            data["pd_history"].append({"date": d.isoformat(), "pd": self.pd_previous})
        if self.pd_current is not None:
            data["pd_history"].append({"date": (self.pd_current_date or today).isoformat(), "pd": self.pd_current})
        last = years[-1].year if years else today.year
        if self.ppm_current is not None or self.otd is not None:
            data["quality"][str(last)] = {
                "ppm": self.ppm_current,
                "otd": self.otd / 100 if self.otd is not None else None,
            }
        if self.ppm_previous is not None:
            data["quality"][str(last - 1)] = {"ppm": self.ppm_previous, "otd": None}
        return data


class Address(BaseModel):
    street: str = ""
    zip: str = Field(default="", max_length=12)
    city: str = ""
    country: str = Field(default="", max_length=3, description="ISO 3166-1 alpha-2, e.g. DE")
    # Optional manual coordinates; otherwise the address is geocoded.
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("street", "zip", "city")
    @classmethod
    def strip_text(cls, v: str) -> str:
        return v.strip()

    @field_validator("country")
    @classmethod
    def upper_country(cls, v: str) -> str:
        return v.strip().upper()


class SupplierIn(Address):
    number: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=2, max_length=200)
    commodity: str = Field(default="Sonstige", min_length=1, max_length=80)
    website: str = ""
    plant_ids: list[str] = []
    buyer_name: str = ""
    buyer_email: EmailStr | None = None
    register_status: Literal["green", "yellow", "red"] = "green"
    source: str = "manual"
    figures: SupplierFigures | None = None

    @field_validator("number", "name", "commodity", "website", "buyer_name")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()


class Contact(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr | None = None
    role: str = Field(default="", max_length=80)

    @field_validator("email", mode="before")
    @classmethod
    def blank_email(cls, v):
        return v.strip() or None if isinstance(v, str) else v


class PlantIn(Address):
    """A plant of the buying organization; its contacts are warned about linked suppliers."""

    name: str = Field(min_length=2, max_length=120)
    contacts: list[Contact] = []


class ImportRequest(BaseModel):
    """Creates a supplier from a source system by its supplier number."""

    source: str
    number: str
    commodity: str = "Sonstige"
    buyer_name: str = ""
    buyer_email: EmailStr | None = None
    plant_ids: list[str] = []


class AutomodeUpdate(BaseModel):
    enabled: bool | None = None
    interval_minutes: int | None = Field(default=None, ge=5, le=60 * 24 * 31)
    channels: list[Literal["inapp", "outlook", "teams"]] | None = None
    lang: Literal["de", "en"] | None = None
