import json
import os
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session
from svix.webhooks import Webhook, WebhookVerificationError

from app.models.models import User


def verify_clerk_webhook(payload: bytes, headers: dict[str, str]) -> dict[str, Any]:
	signing_secret = os.getenv("CLERK_WEBHOOK_SIGNING_SECRET")
	if not signing_secret:
		raise HTTPException(
			status_code=500,
			detail="CLERK_WEBHOOK_SIGNING_SECRET is not configured",
		)

	try:
		webhook = Webhook(signing_secret)
		return webhook.verify(
			payload,
			{
				"svix-id": headers.get("svix-id", ""),
				"svix-timestamp": headers.get("svix-timestamp", ""),
				"svix-signature": headers.get("svix-signature", ""),
			},
		)
	except WebhookVerificationError as exc:
		raise HTTPException(status_code=400, detail="Invalid Clerk webhook signature") from exc


def handle_clerk_webhook(payload: bytes, headers: dict[str, str], db: Session) -> dict[str, Any]:
	event = verify_clerk_webhook(payload, headers)
	event_type = event.get("type")
	data = event.get("data", {})

	if event_type in {"user.created", "user.updated"}:
		upsert_clerk_user(db, data)
	elif event_type == "user.deleted":
		delete_clerk_user(db, data)

	return {
		"ok": True,
		"event_type": event_type,
	}


def upsert_clerk_user(db: Session, clerk_user: dict[str, Any]) -> User:
	clerk_id = clerk_user.get("id")
	if not clerk_id:
		raise HTTPException(status_code=400, detail="Clerk user id missing from payload")

	email = _extract_primary_email(clerk_user)
	if not email:
		raise HTTPException(status_code=400, detail="Clerk user email missing from payload")

	existing_user = db.query(User).filter(User.clerkId == clerk_id).first()
	if existing_user is None:
		existing_user = User(
			clerkId=clerk_id,
			first_name=clerk_user.get("first_name"),
			last_name=clerk_user.get("last_name"),
			email=email,
			phone_number=_extract_primary_phone(clerk_user),
			created_at=_to_string_timestamp(clerk_user.get("created_at")),
			password_hash=None,
		)
		db.add(existing_user)
	else:
		existing_user.first_name = clerk_user.get("first_name")
		existing_user.last_name = clerk_user.get("last_name")
		existing_user.email = email
		existing_user.phone_number = _extract_primary_phone(clerk_user)

	db.commit()
	db.refresh(existing_user)
	return existing_user


def delete_clerk_user(db: Session, clerk_user: dict[str, Any]) -> bool:
	clerk_id = clerk_user.get("id")
	if not clerk_id:
		return False

	existing_user = db.query(User).filter(User.clerkId == clerk_id).first()
	if existing_user is None:
		return False

	db.delete(existing_user)
	db.commit()
	return True


def _extract_primary_email(clerk_user: dict[str, Any]) -> str | None:
	primary_email_id = clerk_user.get("primary_email_address_id")
	email_addresses = clerk_user.get("email_addresses") or []

	for email_obj in email_addresses:
		if email_obj.get("id") == primary_email_id:
			return email_obj.get("email_address")

	if email_addresses:
		return email_addresses[0].get("email_address")

	unsafe_metadata = clerk_user.get("unsafe_metadata") or {}
	if isinstance(unsafe_metadata, dict):
		email = unsafe_metadata.get("email")
		if isinstance(email, str):
			return email

	return None


def _extract_primary_phone(clerk_user: dict[str, Any]) -> str | None:
	primary_phone_id = clerk_user.get("primary_phone_number_id")
	phone_numbers = clerk_user.get("phone_numbers") or []

	for phone_obj in phone_numbers:
		if phone_obj.get("id") == primary_phone_id:
			return phone_obj.get("phone_number")

	if phone_numbers:
		return phone_numbers[0].get("phone_number")

	return None


def _to_string_timestamp(timestamp: Any) -> str | None:
	if timestamp is None:
		return None
	return json.dumps(timestamp).strip('"')
