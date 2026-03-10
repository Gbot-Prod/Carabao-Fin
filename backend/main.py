from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine
from app.models.models import Base
from app.api.routes.router import router  # import your router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # your Next.js URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)  # DB init stays here
app.include_router(router)             # register all routes