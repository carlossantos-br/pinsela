# Bundled fonts

All fonts in `google/` come from Google Fonts, are shipped as latin-subset
WOFF2 files and are licensed under the SIL Open Font License 1.1
(see `google/OFL.txt`). Inter is the UI font and the default text family.

| Family | Copyright |
|---|---|
| Archivo | Copyright 2019 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo) |
| DM Sans | Copyright 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts) |
| Inter | Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter) |
| Montserrat | Copyright 2011 The Montserrat Project Authors (https://github.com/JulietaUla/Montserrat) |
| Playfair Display | Copyright 2017 The Playfair Display Project Authors (https://github.com/clauseggers/Playfair-Display) |
| Plus Jakarta Sans | Copyright 2020 The Plus Jakarta Sans Project Authors (https://github.com/tokotype/PlusJakartaSans) |
| Poppins | Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins) |
| Space Grotesk | Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk) |

The server-side renderer reads the same files from `ui/public/fonts/google/`.
Extra font directories can be added with `PINSELA_FONT_DIRS`.
