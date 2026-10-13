from __future__ import annotations


DEFAULT_TEMPLATE_KEY = "master"


def default_template_schema() -> dict:
    # This is intentionally not strict JSON Schema; it's a lightweight, editable schema
    # the system can validate and evolve without refactoring.
    return {
        "version": 2,
        "ui": {
            "groups": [
                {
                    "id": "identity",
                    "title": "Identity",
                    "description": "Organization data (internal name, category and tags).",
                    "fields": ["identity_name", "category"],
                    "arrays": ["tags"],
                },
                {
                    "id": "content",
                    "title": "Main content",
                    "description": "Text that appears on the artwork.",
                    "fields": ["title", "subtitle", "body"],
                    "arrays": ["body_blocks"],
                },
                {
                    "id": "images",
                    "title": "Images",
                    "description": "Hero (main) + products/items (0 to 8).",
                    "fields": ["hero_image"],
                    "arrays": ["device_images"],
                },
                {
                    "id": "pricing",
                    "title": "Price and terms",
                    "description": "Price structure (upfront / installments) + notes.",
                    "fields": [
                        "billing_type",
                        "billing_type_other",
                        "type_note",
                        "price",
                        "installments_count",
                        "installments_value",
                        "installments",
                        "payment_note",
                    ],
                    "arrays": [],
                },
                {
                    "id": "pricing_variants",
                    "title": "Variations (optional)",
                    "description": "Extra fields for masters with 2 price/quantity blocks.",
                    "fields": [
                        "quantity_1",
                        "price1",
                        "installments1",
                        "payment_note1",
                        "quantity_2",
                        "price2",
                        "installments2",
                        "payment_note2",
                    ],
                    "arrays": [],
                },
                {
                    "id": "footer",
                    "title": "Footer",
                    "description": "Contact and validity/stock.",
                    "fields": ["footer_phone", "footer_city_uf", "footer_note"],
                    "arrays": [],
                },
            ]
        },
        "fields": {
            # A) Identity
            "identity_name": {"type": "string", "required": True, "maxLength": 64, "label": "Artwork name", "ui": {"placeholder": "e.g. Lipbalm + Sunscreen + Micellar Water"}},
            "category": {"type": "string", "required": False, "maxLength": 64, "label": "Category (optional)", "ui": {"placeholder": "e.g. Sale"}},

            # B) Main content
            "title": {"type": "string", "required": True, "maxLength": 48, "label": "Title"},
            "subtitle": {"type": "string", "required": False, "maxLength": 72, "label": "Subtitle"},
            "body": {"type": "string", "required": False, "maxLength": 520, "label": "Description", "ui": {"widget": "textarea"}},

            # C) Images
            "hero_image": {"type": "string", "required": False, "maxLength": 512, "label": "Main image (hero)", "ui": {"widget": "image", "placeholder": "URL/path/ref"}},

            # D) Price and terms
            "billing_type": {
                "type": "string",
                "required": False,
                "maxLength": 32,
                "label": "Billing type",
                "enum": ["per unit", "per pack", "per kit", "other"],
            },
            "billing_type_other": {"type": "string", "required": False, "maxLength": 32, "label": "Other (short)"},
            "type_note": {"type": "string", "required": False, "maxLength": 40, "label": "Displayed type (e.g. per unit)"},
            # Backward-compatible fields still used by the default mapping (PRICE / INSTALLMENTS).
            "price": {"type": "string", "required": False, "maxLength": 24, "format": "brl_price", "label": "Price (upfront)", "ui": {"placeholder": "e.g. R$ 129,90"}},
            "installments": {"type": "string", "required": False, "maxLength": 64, "label": "Installment price (text)", "ui": {"placeholder": "e.g. 10x of R$ 19,90"}},
            "installments_count": {"type": "string", "required": False, "maxLength": 8, "label": "Number of installments", "ui": {"placeholder": "e.g. 10"}},
            "installments_value": {"type": "string", "required": False, "maxLength": 24, "label": "Installment value", "ui": {"placeholder": "e.g. R$ 19,90"}},
            "payment_note": {"type": "string", "required": False, "maxLength": 72, "label": "Payment note", "ui": {"placeholder": "e.g. via pix or link"}},
            "quantity_1": {"type": "string", "required": False, "maxLength": 32, "label": "Quantity 1 (master 3)", "ui": {"placeholder": "e.g. (1 vial)"}},
            "price1": {"type": "string", "required": False, "maxLength": 24, "format": "brl_price", "label": "Price 1", "ui": {"placeholder": "e.g. R$ 999,90"}},
            "installments1": {"type": "string", "required": False, "maxLength": 64, "label": "Installments 1", "ui": {"placeholder": "e.g. 10x of R$ 120,00"}},
            "payment_note1": {"type": "string", "required": False, "maxLength": 40, "label": "Note 1", "ui": {"placeholder": "e.g. via pix"}},
            "quantity_2": {"type": "string", "required": False, "maxLength": 32, "label": "Quantity 2 (master 3)", "ui": {"placeholder": "e.g. (2 vials)"}},
            "price2": {"type": "string", "required": False, "maxLength": 24, "format": "brl_price", "label": "Price 2", "ui": {"placeholder": "e.g. R$ 1.699,90"}},
            "installments2": {"type": "string", "required": False, "maxLength": 64, "label": "Installments 2", "ui": {"placeholder": "e.g. 10x of R$ 210,00"}},
            "payment_note2": {"type": "string", "required": False, "maxLength": 40, "label": "Note 2", "ui": {"placeholder": "e.g. via link"}},

            # E) Footer
            "footer_phone": {"type": "string", "required": False, "maxLength": 32, "label": "Phone"},
            "footer_city_uf": {"type": "string", "required": False, "maxLength": 32, "label": "City/State", "ui": {"placeholder": "e.g. Austin/TX"}},
            "footer_note": {"type": "string", "required": False, "maxLength": 96, "label": "Validity/stock (optional)", "ui": {"widget": "textarea"}},
        },
        "arrays": {
            "tags": {"type": "string[]", "required": False, "maxItems": 20, "label": "Tags", "ui": {"widget": "tags"}},
            "body_blocks": {"type": "string[]", "required": False, "maxItems": 3, "label": "Main text (1-3 blocks)", "ui": {"widget": "paragraphs"}},
            # Each entry can be an URL, a storage path, or an opaque ref depending on adapters.
            "device_images": {"type": "image[]", "required": False, "maxItems": 8, "label": "Product/item images (0-8)", "ui": {"widget": "image"}},
        },
    }


def default_template_mapping() -> dict:
    return {
        "text_nodes": {
            "title": {"by": "name", "value": "TITLE"},
            "subtitle": {"by": "name", "value": "SUBTITLE"},
            "body": {"by": "name", "value": "BODY"},
            "type_note": {"by": "name", "value": "TYPE_NOTE"},
            "price": {"by": "name", "value": "PRICE"},
            "installments": {"by": "name", "value": "INSTALLMENTS"},
            "payment_note": {"by": "name", "value": "PAYMENT_NOTE"},
            "payment_note1": {"by": "name", "value": "PAYMENT_NOTE1"},
            "payment_note2": {"by": "name", "value": "PAYMENT_NOTE2"},
            "price1": {"by": "name", "value": "PRICE1"},
            "price2": {"by": "name", "value": "PRICE2"},
            "installments1": {"by": "name", "value": "INSTALLMENTS1"},
            "installments2": {"by": "name", "value": "INSTALLMENTS2"},
            "quantity_1": {"by": "name", "value": "QUANTITY_1"},
            "quantity_2": {"by": "name", "value": "QUANTITY_2"},
            "footer_phone": {"by": "name", "value": "FOOTER_PHONE"},
            "footer_city_uf": {"by": "name", "value": "FOOTER_CITY_UF"},
            "footer_note": {"by": "name", "value": "FOOTER_NOTE"},
        },
        "hero_image": {"by": "name", "value": "HERO"},
        "device_images": {
            "container": {"by": "name", "value": "DEVICES"},
            "slots": [{"by": "name", "value": f"DEVICE_{i}"} for i in range(1, 9)],
            "hide_empty": True,
        },
    }
