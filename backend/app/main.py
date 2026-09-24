import base64
import datetime as dt
import json
import os
from pathlib import Path
from typing import Optional

import bcrypt
import jwt
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'meditrack.db'}")
if DATABASE_URL.startswith("postgres://"):
    # Some hosts give postgres:// URLs, which SQLAlchemy does not accept.
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    medications: Mapped[list["Medication"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    notifications: Mapped[list["Notification"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Medication(Base):
    __tablename__ = "medications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(160))
    dosage: Mapped[str] = mapped_column(String(100))
    frequency: Mapped[str] = mapped_column(String(100))
    time: Mapped[str] = mapped_column(String(10))
    start_date: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    end_date: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    taken: Mapped[bool] = mapped_column(Boolean, default=False)
    last_taken_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    user: Mapped[User] = relationship(back_populates="medications")


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(180))
    body: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(50), default="info")
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    user: Mapped[User] = relationship(back_populates="notifications")


Base.metadata.create_all(bind=engine)

app = FastAPI(title="MediTrack API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer(auto_error=False)


def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def hash_password(password: str) -> str:
    # bcrypt has a 72-byte input limit; reject overly long passwords cleanly.
    raw = password.encode("utf-8")
    if len(raw) > 72:
        raise HTTPException(status_code=400, detail="Password must be 72 bytes or fewer.")
    return bcrypt.hashpw(raw, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    raw = password.encode("utf-8")
    if len(raw) > 72:
        return False
    try:
        return bcrypt.checkpw(raw, hashed.encode("utf-8"))
    except ValueError:
        return False


def make_token(user: User) -> str:
    now = dt.datetime.utcnow()
    payload = {"sub": str(user.id), "email": user.email, "exp": now + dt.timedelta(days=7)}
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    session: Session = Depends(db),
) -> User:
    if not credentials:
        raise HTTPException(status_code=401, detail="Authentication required.")
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=["HS256"])
        user_id = int(payload["sub"])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found. Please sign in again.")
    return user


class AuthIn(BaseModel):
    name: str = ""
    email: EmailStr
    password: str = Field(min_length=6, max_length=72)


class MedicationIn(BaseModel):
    name: str
    dosage: str
    frequency: str
    time: str
    start_date: str = ""
    end_date: str = ""
    instructions: str = ""


def user_json(user: User):
    return {"id": user.id, "name": user.name, "email": user.email}


def med_json(m: Medication):
    return {
        "id": m.id,
        "name": m.name,
        "dosage": m.dosage,
        "frequency": m.frequency,
        "time": m.time,
        "start_date": m.start_date or "",
        "end_date": m.end_date or "",
        "instructions": m.instructions or "",
        "taken": m.taken,
        "last_taken_at": m.last_taken_at.isoformat() if m.last_taken_at else None,
    }


def notification_json(n: Notification):
    return {
        "id": n.id,
        "title": n.title,
        "body": n.body,
        "kind": n.kind,
        "read": n.read,
        "created_at": n.created_at.isoformat(),
    }


@app.get("/api/health")
def health():
    return {"ok": True, "service": "MediTrack API", "gemini_configured": bool(GEMINI_API_KEY)}


@app.post("/api/auth/register")
def register(data: AuthIn, session: Session = Depends(db)):
    email = data.email.lower().strip()
    if session.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    user = User(
        name=data.name.strip() or email.split("@")[0],
        email=email,
        password_hash=hash_password(data.password),
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    session.add(Notification(
        user_id=user.id,
        title="Welcome to MediTrack",
        body="Your medication dashboard is ready. Add your first medicine to begin.",
        kind="welcome",
    ))
    session.commit()

    return {"access_token": make_token(user), "token_type": "bearer", "user": user_json(user)}


@app.post("/api/auth/login")
def login(data: AuthIn, session: Session = Depends(db)):
    email = data.email.lower().strip()
    user = session.scalar(select(User).where(User.email == email))
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    return {"access_token": make_token(user), "token_type": "bearer", "user": user_json(user)}


@app.get("/api/auth/me")
def me(user: User = Depends(current_user)):
    return user_json(user)


@app.get("/api/medications")
def get_medications(user: User = Depends(current_user), session: Session = Depends(db)):
    meds = session.scalars(
        select(Medication).where(Medication.user_id == user.id).order_by(Medication.time)
    ).all()
    return [med_json(m) for m in meds]


@app.post("/api/medications")
def create_medication(
    data: MedicationIn,
    user: User = Depends(current_user),
    session: Session = Depends(db),
):
    med = Medication(user_id=user.id, **data.model_dump())
    session.add(med)
    session.flush()
    session.add(Notification(
        user_id=user.id,
        title="Medication added",
        body=f"{med.name} ({med.dosage}) was added to your schedule at {med.time}.",
        kind="medication",
    ))
    session.commit()
    session.refresh(med)
    return med_json(med)


@app.put("/api/medications/{med_id}")
def update_medication(
    med_id: int,
    data: MedicationIn,
    user: User = Depends(current_user),
    session: Session = Depends(db),
):
    med = session.scalar(select(Medication).where(Medication.id == med_id, Medication.user_id == user.id))
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found.")
    for key, value in data.model_dump().items():
        setattr(med, key, value)
    session.commit()
    session.refresh(med)
    return med_json(med)


@app.delete("/api/medications/{med_id}")
def delete_medication(
    med_id: int,
    user: User = Depends(current_user),
    session: Session = Depends(db),
):
    med = session.scalar(select(Medication).where(Medication.id == med_id, Medication.user_id == user.id))
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found.")
    session.delete(med)
    session.commit()
    return {"ok": True}


@app.post("/api/medications/{med_id}/taken")
def take_medication(
    med_id: int,
    user: User = Depends(current_user),
    session: Session = Depends(db),
):
    med = session.scalar(select(Medication).where(Medication.id == med_id, Medication.user_id == user.id))
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found.")
    med.taken = True
    med.last_taken_at = dt.datetime.utcnow()
    session.add(Notification(
        user_id=user.id,
        title="Dose recorded",
        body=f"{med.name} was marked as taken.",
        kind="dose",
    ))
    session.commit()
    return med_json(med)


@app.post("/api/medications/{med_id}/reset")
def reset_medication(
    med_id: int,
    user: User = Depends(current_user),
    session: Session = Depends(db),
):
    med = session.scalar(select(Medication).where(Medication.id == med_id, Medication.user_id == user.id))
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found.")
    med.taken = False
    session.commit()
    return med_json(med)


@app.get("/api/adherence")
def get_adherence(
    user: User = Depends(current_user),
    session: Session = Depends(db)
):
    meds = session.scalars(
        select(Medication).where(Medication.user_id == user.id)
    ).all()

    total = len(meds)
    taken = sum(1 for m in meds if m.taken)
    pending = total - taken
    percentage = round((taken / total) * 100) if total else 0

    # Weekly data
    from datetime import date, timedelta

    today = date.today()
    start_of_week = today - timedelta(days=today.weekday())

    weekly = []

    for i in range(7):
        day = start_of_week + timedelta(days=i)

        day_meds = [
            m for m in meds
            if m.created_at and m.created_at.date() == day
        ]

        day_total = len(day_meds)
        day_taken = sum(1 for m in day_meds if m.taken)

        day_percentage = (
            round((day_taken / day_total) * 100)
            if day_total
            else 0
        )

        weekly.append({
            "day": day.strftime("%a")[0],
            "date": day.isoformat(),
            "percentage": day_percentage
        })

    return {
        "total": total,
        "taken": taken,
        "pending": pending,
        "percentage": percentage,
        "weekly": weekly
    }


@app.get("/api/notifications")
def get_notifications(user: User = Depends(current_user), session: Session = Depends(db)):
    # Create a due reminder once per medication per calendar day when the scheduled time has arrived.
    now = dt.datetime.now()
    today = now.date().isoformat()
    meds = session.scalars(select(Medication).where(Medication.user_id == user.id)).all()

    for med in meds:
        try:
            hour, minute = [int(x) for x in med.time.split(":")[:2]]
        except Exception:
            continue
        if now.hour * 60 + now.minute < hour * 60 + minute or med.taken:
            continue

        marker = f"{today}:{med.id}"
        exists = session.scalar(
            select(Notification).where(
                Notification.user_id == user.id,
                Notification.kind == "reminder",
                Notification.body.contains(marker),
            )
        )
        if not exists:
            session.add(Notification(
                user_id=user.id,
                title=f"Time for {med.name}",
                body=f"Scheduled dose: {med.dosage}.|{marker}",
                kind="reminder",
            ))
    session.commit()

    notes = session.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
        .limit(50)
    ).all()
    return {"items": [notification_json(n) for n in notes],
            "unread": sum(1 for n in notes if not n.read)}


@app.post("/api/notifications/{notification_id}/read")
def read_notification(
    notification_id: int,
    user: User = Depends(current_user),
    session: Session = Depends(db),
):
    n = session.scalar(
        select(Notification).where(Notification.id == notification_id, Notification.user_id == user.id)
    )
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found.")
    n.read = True
    session.commit()
    return notification_json(n)


@app.post("/api/notifications/read-all")
def read_all_notifications(user: User = Depends(current_user), session: Session = Depends(db)):
    notes = session.scalars(select(Notification).where(Notification.user_id == user.id, Notification.read == False)).all()
    for n in notes:
        n.read = True
    session.commit()
    return {"ok": True}


@app.post("/api/prescription/upload")
async def prescription_upload(
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    session: Session = Depends(db),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload a prescription image (JPG, PNG, WEBP, etc.).")

    raw = await file.read()
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image is too large. Please use an image under 8 MB.")

    if not GEMINI_API_KEY:
        session.add(Notification(
            user_id=user.id,
            title="Prescription uploaded",
            body="The prescription was uploaded, but Gemini is not configured yet. Add GEMINI_API_KEY to backend/.env.",
            kind="prescription",
        ))
        session.commit()
        return {
            "ok": True,
            "message": "Prescription uploaded successfully.",
            "ai_status": "Gemini is not configured. Add GEMINI_API_KEY to backend/.env.",
            "analysis": None,
        }

    prompt = """Analyze this prescription image for data entry assistance.
Return ONLY valid JSON with this shape:
{
  "medications": [
    {
      "name": "",
      "dosage": "",
      "frequency": "",
      "time": "",
      "instructions": ""
    }
  ],
  "notes": ""
}
Do not invent missing information. If something is unreadable, leave it empty.
This is an extraction aid, not medical advice. A human must verify all extracted medication details."""

    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {
                    "mime_type": file.content_type,
                    "data": base64.b64encode(raw).decode("ascii"),
                }},
            ]
        }]
    }

    # Gemini 3.6 Flash is the default production model. If Google returns
    # a temporary 503 for the configured model, retry once with the stable
    # Gemini 3.5 Flash model instead of exposing the transient provider error.
    # models_to_try = [GEMINI_MODEL]
    # if GEMINI_MODEL != "gemini-3.6-flash":
    #     models_to_try.append("gemini-3.6-flash")
    # if "gemini-3.5-flash" not in models_to_try:
    #     models_to_try.append("gemini-3.5-flash")
   
    models_to_try = [GEMINI_MODEL]

    for fallback_model in ["gemini-2.5-flash", "gemini-2.0-flash"]:
      if fallback_model not in models_to_try:
        models_to_try.append(fallback_model)

        last_error = None
    analysis = None

    for model in models_to_try:
        response = None
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

        try:
            response = requests.post(
                endpoint,
                headers={
                    "x-goog-api-key": GEMINI_API_KEY,
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=90,
            )

            if response.status_code == 503:
                last_error = f"Gemini temporarily unavailable (503) for model {model}."
                continue

            response.raise_for_status()

            data = response.json()

            text = data["candidates"][0]["content"]["parts"][0]["text"].strip()

            cleaned = (
                text
                .replace("```json", "")
                .replace("```", "")
                .strip()
            )

            analysis = json.loads(cleaned)

            # Gemini succeeded
            break

        except (
            requests.RequestException,
            KeyError,
            IndexError,
            TypeError,
            json.JSONDecodeError,
        ) as exc:
            last_error = f"{model}: {exc}"
            continue

    # Gemini failed with every model
    if analysis is None:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini analysis failed after model fallback: {last_error or 'Unknown Gemini error.'}",
        )

    session.add(Notification(
        user_id=user.id,
        title="Prescription analysis complete",
        body="Gemini finished extracting medication information. Please verify it before saving.",
        kind="ai",
    ))

    session.commit()

    return {
        "ok": True,
        "message": "Prescription uploaded successfully.",
        "ai_status": "Gemini analysis completed.",
        "analysis": analysis,
    }