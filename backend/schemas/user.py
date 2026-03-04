from pydantic import BaseModel


class UserCreate(BaseModel):
    firstName: str
    lastName: str
    email: str
    password: str


class UserResponse(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: str

    class Config:
        from_attributes = True
