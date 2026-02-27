from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import models
from .auth import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from .database import engine, get_db
from .schemas import LoginRequest, SignupRequest, TokenResponse, UserResponse

# Create all tables on startup
models.Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> models.User:
    payload = decode_access_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.query(models.User).filter(models.User.email == payload.get("sub")).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@app.post("/auth/signup", response_model=TokenResponse)
def signup(request: SignupRequest, db: Session = Depends(get_db)):
    if request.password != request.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords don't match")

    existing = db.query(models.User).filter(models.User.email == request.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = models.User(
        full_name=request.full_name,
        email=request.email,
        hashed_password=hash_password(request.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": user.email})
    return TokenResponse(access_token=token, user=UserResponse.model_validate(user))


@app.post("/auth/login", response_model=TokenResponse)
def login(request: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == request.email).first()
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token({"sub": user.email})
    return TokenResponse(access_token=token, user=UserResponse.model_validate(user))


@app.get("/auth/me", response_model=UserResponse)
def get_me(current_user: models.User = Depends(get_current_user)):
    return current_user


@app.get("/health")
def health():
    return {"ok": True}