from fastapi import FastAPI
from database import engine
from app.models.models import Base
from app.api.routes.router import router  # import your router

app = FastAPI()

Base.metadata.create_all(bind=engine)  # DB init stays here

app.include_router(router)             # register all routes