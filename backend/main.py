from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine
from routers.users import router as users_router

import models 

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)
models.Base.metadata.create_all(bind=engine)

app.include_router(users_router)