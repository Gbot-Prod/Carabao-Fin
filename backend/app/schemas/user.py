from pydantic import BaseModel

class UserBase(BaseModel):
    first_name: str
    last_name: str
    phone_number: str
    email: str
    password_hash: str

class UserResponse(UserBase):
    id: int
    class Config:
        from_attributes = True