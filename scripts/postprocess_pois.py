import json
import sys
from shapely.geometry import shape

def kind_from_props(p: dict):
    # Synagogue
    if p.get("building") == "synagogue":
        return "synagogue"
    if p.get("amenity") == "place_of_worship" and p.get("religion") == "jewish":
        return "synagogue"

    # Kosher
    if p.get("diet:kosher") in ("yes", "only"):
        return "kosher"

    # JCC (name-based fallback)
    name = (p.get("name") or "").lower()
    if "jcc" in name or "jewish community center" in name or "jewish community centre" in name:
        return "jcc"

    return None

def get_point(geom: dict):
    if not geom:
        return None
    t = geom.get("type")
    if t == "Point":
        return geom.get("coordinates")
    try:
        g = shape(geom)
        pt = g.representative_point()
        return [float(pt.x), float(pt.y)]
    except Exception:
        return None

def main():
    if len(sys.argv) != 3:
        print("Usage: python scripts/postprocess_pois.py <in.geojson> <out.geojson>")
        sys.exit(1)

    in_path, out_path = sys.argv[1], sys.argv[2]
    data = json.load(open(in_path, "r", encoding="utf-8"))

    feats = data.get("features") or []
    out = []
    seen = set()

    for f in feats:
        props = f.get("properties") or {}
        geom = f.get("geometry") or {}

        kind = kind_from_props(props)
        if not kind:
            continue

        coord = get_point(geom)
        if not coord:
            continue

        osm_id = props.get("@id") or props.get("id") or ""
        name = props.get("name") or ""

        # de-dupe primarily by osm id; fallback to kind+rounded coord+name
        key = osm_id if osm_id else f"{kind}:{round(coord[0],5)}:{round(coord[1],5)}:{name.strip().lower()}"
        if key in seen:
            continue
        seen.add(key)

        out.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": coord},
            "properties": {
                "kind": kind,
                "name": name,
                "osm_id": osm_id,
                "source": "osm"
            }
        })

    fc = {"type": "FeatureCollection", "features": out}
    with open(out_path, "w", encoding="utf-8") as w:
        json.dump(fc, w)

    print(f"Wrote {len(out)} features -> {out_path}")

if __name__ == "__main__":
    main()
