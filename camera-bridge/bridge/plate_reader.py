import logging
import requests
import json

logger = logging.getLogger("camera-bridge.plate-reader")

class PlateReaderAdapter:
    def read_plate(self, image_bytes: bytes) -> dict:
        """
        Processes image and returns license plate details.
        Returns:
            {
                "status": "NONE | CANDIDATE | CONFIRMED | UNREADABLE",
                "text": "ABC1234",
                "normalizedText": "ABC1234",
                "state": "OH",
                "confidence": 0.85,
                "provider": "provider_name"
            }
        """
        raise NotImplementedError

class DisabledPlateReaderAdapter(PlateReaderAdapter):
    def read_plate(self, image_bytes: bytes) -> dict:
        return {
            "status": "NONE",
            "text": "",
            "normalizedText": "",
            "state": "",
            "confidence": 0.0,
            "provider": "disabled"
        }

class MockPlateReaderAdapter(PlateReaderAdapter):
    def read_plate(self, image_bytes: bytes) -> dict:
        # Mock successful detection for dry-runs / simulations
        return {
            "status": "CANDIDATE",
            "text": "NICKS1",
            "normalizedText": "NICKS1",
            "state": "OH",
            "confidence": 0.92,
            "provider": "mock"
        }

class PlateRecognizerReaderAdapter(PlateReaderAdapter):
    def __init__(self, api_token: str):
        self.api_token = api_token
        self.api_url = "https://api.platerecognizer.com/v1/plate-reader/"

    def read_plate(self, image_bytes: bytes) -> dict:
        if not self.api_token:
            logger.warning("Plate Recognizer token is empty. Falling back.")
            return {"status": "NONE", "text": "", "normalizedText": "", "state": "", "confidence": 0.0, "provider": "plate_recognizer_unconfigured"}

        try:
            logger.info("Calling Plate Recognizer API...")
            response = requests.post(
                self.api_url,
                files={"upload": ("image.jpg", image_bytes, "image/jpeg")},
                headers={"Authorization": f"Token {self.api_token}"},
                timeout=10
            )
            
            if response.status_code != 201 and response.status_code != 200:
                logger.error(f"Plate Recognizer API failed ({response.status_code}): {response.text}")
                return {"status": "NONE", "text": "", "normalizedText": "", "state": "", "confidence": 0.0, "provider": "plate_recognizer_error"}

            data = response.json()
            results = data.get("results", [])
            
            if not results:
                return {
                    "status": "UNREADABLE",
                    "text": "",
                    "normalizedText": "",
                    "state": "",
                    "confidence": 0.0,
                    "provider": "plate_recognizer"
                }

            best_match = results[0]
            plate = best_match.get("plate", "").upper()
            confidence = best_match.get("dscore", 0.0)
            region = best_match.get("region", {}).get("code", "").upper()

            # Map confidence into status tiers
            status = "CONFIRMED" if confidence > 0.8 else "CANDIDATE"

            return {
                "status": status,
                "text": plate,
                "normalizedText": plate,
                "state": region,
                "confidence": confidence,
                "provider": "plate_recognizer"
            }
        except Exception as e:
            logger.error(f"Plate Recognizer request exception: {e}")
            return {"status": "NONE", "text": "", "normalizedText": "", "state": "", "confidence": 0.0, "provider": "plate_recognizer_exception"}

class LocalEasyOcrReaderAdapter(PlateReaderAdapter):
    def __init__(self):
        self.reader = None
        try:
            import easyocr
            # Load English reader on initialization
            self.reader = easyocr.Reader(['en'], gpu=False)
            logger.info("EasyOCR initialized successfully")
        except ImportError:
            logger.warning("easyocr module not installed. EasyOCR adapter is unavailable.")

    def read_plate(self, image_bytes: bytes) -> dict:
        if not self.reader:
            logger.error("EasyOCR is not installed or initialized. Falling back.")
            return {"status": "NONE", "text": "", "normalizedText": "", "state": "", "confidence": 0.0, "provider": "easyocr_missing"}

        try:
            import cv2
            import numpy as np

            # Convert raw bytes to image matrix
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            # Perform basic grayscale and thresholding to improve OCR accuracy
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            
            # EasyOCR works directly on NumPy arrays
            results = self.reader.readtext(gray)
            
            if not results:
                return {
                    "status": "UNREADABLE",
                    "text": "",
                    "normalizedText": "",
                    "state": "",
                    "confidence": 0.0,
                    "provider": "easyocr"
                }

            # Filter for the best match (or concat words that look like plates)
            # Typically a license plate has 5-8 alpha-numeric characters
            best_text = ""
            best_conf = 0.0
            
            for bbox, text, conf in results:
                text_clean = "".join(c for c in text if c.isalnum()).upper()
                if 4 <= len(text_clean) <= 9 and conf > best_conf:
                    best_text = text_clean
                    best_conf = conf

            if not best_text:
                return {"status": "UNREADABLE", "text": "", "normalizedText": "", "state": "", "confidence": 0.0, "provider": "easyocr"}

            status = "CONFIRMED" if best_conf > 0.75 else "CANDIDATE"

            return {
                "status": status,
                "text": best_text,
                "normalizedText": best_text,
                "state": "OH", # assume local state default
                "confidence": float(best_conf),
                "provider": "easyocr"
            }
        except Exception as e:
            logger.error(f"Local EasyOCR exception: {e}")
            return {"status": "NONE", "text": "", "normalizedText": "", "state": "", "confidence": 0.0, "provider": "easyocr_exception"}

def get_plate_reader(config) -> PlateReaderAdapter:
    """Factory function to build the correct plate reader based on config."""
    if not config.get("enabled", True):
        return DisabledPlateReaderAdapter()

    provider = config.get("provider", "disabled").lower()
    
    if provider == "disabled":
        return DisabledPlateReaderAdapter()
    elif provider == "mock":
        return MockPlateReaderAdapter()
    elif provider == "plate_recognizer":
        return PlateRecognizerReaderAdapter(config.get("apiToken", ""))
    elif provider == "easyocr":
        return LocalEasyOcrReaderAdapter()
    else:
        logger.warning(f"Unknown ALPR provider '{provider}'. Using DisabledPlateReaderAdapter.")
        return DisabledPlateReaderAdapter()
