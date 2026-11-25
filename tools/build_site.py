"""Build the published static website from the files kept in GitHub."""
import argparse
import json
from pathlib import Path, PurePosixPath
import shutil
from tempfile import TemporaryDirectory
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
STATIC = (
    ".nojekyll", "index.html", "app.js", "bank.js", "timings.js", "style.css",
    "study-data.js", "install.js", "reminders.js", "sw.js", "manifest.webmanifest",
    "icon-192.png", "icon-512.png",
)
THEME = ("person-1.webp", "person-4.webp") + tuple(f"pet-{i}.webp" for i in range(1, 7))


def export_material(stage: Path) -> None:
    data = (ROOT / "bank.js").read_text(encoding="utf-8").strip()
    bank = json.loads(data.removeprefix("window.TOEIC_BANK = ").removesuffix(";"))
    expected = {name for group in bank["groups"].values() for name in group.get("images", [])}
    with ZipFile(ROOT / "material.zip") as archive:
        members = [entry for entry in archive.infolist() if not entry.is_dir()]
        if len(members) != len(expected) or {entry.filename for entry in members} != expected:
            raise ValueError("material.zip does not match the images referenced by bank.js")
        output = stage / "material"
        output.mkdir()
        for entry in members:
            name = PurePosixPath(entry.filename)
            if name.parts != ("material", name.name) or name.suffix != ".webp" or not entry.file_size:
                raise ValueError(f"Invalid material archive path: {entry.filename}")
            with archive.open(entry) as source, (output / name.name).open("wb") as destination:
                shutil.copyfileobj(source, destination)


def export_audio(stage: Path) -> None:
    for number in range(1, 5):
        name = f"listening-{number}.m4a"
        with (stage / name).open("wb") as destination:
            for part in (1, 2):
                with (ROOT / f"{name}.part-{part}").open("rb") as source:
                    header = source.read(8)
                    if len(header) != 8 or (part == 1 and header[4:] != b"ftyp"):
                        raise ValueError(f"Invalid recording data in {name}.part-{part}")
                    destination.write(header)
                    shutil.copyfileobj(source, destination)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "_site", help="Output directory")
    destination = parser.parse_args().output.resolve()
    if ROOT.is_relative_to(destination):
        parser.error("Choose an output directory outside the repository source root.")
    destination.parent.mkdir(parents=True, exist_ok=True)

    with TemporaryDirectory(prefix=".toeic-site-", dir=destination.parent) as directory:
        stage = Path(directory)
        for name in STATIC:
            shutil.copyfile(ROOT / name, stage / name)
        (stage / "theme").mkdir()
        for name in THEME:
            shutil.copyfile(ROOT / "theme" / name, stage / "theme" / name)
        export_material(stage)
        export_audio(stage)
        shutil.copytree(stage, destination, dirs_exist_ok=True)
    print(f"Built TOEIC practice website at {destination}")


if __name__ == "__main__":
    main()
