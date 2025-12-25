"""Endpoints relacionados con casos de personas desaparecidas."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/cases", tags=["cases"])


@router.get("/ping")
async def ping() -> dict[str, str]:
    """Endpoint de prueba para verificar el servicio de casos."""

    return {"message": "Servicio de casos operativo"}
