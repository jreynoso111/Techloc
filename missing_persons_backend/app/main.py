"""Entry point for the missing persons backend service."""

from __future__ import annotations

from fastapi import FastAPI

from app.api.cases import router as cases_router


def create_app() -> FastAPI:
    """Configure and return the FastAPI application instance."""

    application = FastAPI(title="Missing Persons Backend")
    application.include_router(cases_router)
    return application


app = create_app()


def main() -> None:
    """Run the FastAPI application with Uvicorn."""

    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    main()
