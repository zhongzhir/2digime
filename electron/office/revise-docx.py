import json
import pathlib
import subprocess
import sys
import time
import uuid

import uno
from com.sun.star.beans import PropertyValue


def prop(name, value):
    item = PropertyValue()
    item.Name = name
    item.Value = value
    return item


def count_matches(document, needle, match_case):
    descriptor = document.createSearchDescriptor()
    descriptor.SearchString = needle
    descriptor.SearchCaseSensitive = bool(match_case)
    count = 0
    found = document.findFirst(descriptor)
    while found is not None:
        count += 1
        found = document.findNext(found, descriptor)
    return count


def main():
    request_path = pathlib.Path(sys.argv[1]).resolve()
    soffice_path = pathlib.Path(sys.argv[2]).resolve()
    request = json.loads(request_path.read_text(encoding="utf-8"))
    output_path = pathlib.Path(request["outputPath"]).resolve()
    pipe_name = "2digime_" + uuid.uuid4().hex
    office = subprocess.Popen(
        [
            str(soffice_path),
            "--headless",
            "--nologo",
            "--nodefault",
            "--nofirststartwizard",
            "--norestore",
            f"--accept=pipe,name={pipe_name};urp;StarOffice.ComponentContext",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    document = None
    try:
        local_context = uno.getComponentContext()
        resolver = local_context.ServiceManager.createInstanceWithContext(
            "com.sun.star.bridge.UnoUrlResolver", local_context
        )
        context = None
        for _ in range(60):
            try:
                context = resolver.resolve(
                    f"uno:pipe,name={pipe_name};urp;StarOffice.ComponentContext"
                )
                break
            except Exception:
                time.sleep(0.1)
        if context is None:
            raise RuntimeError("LibreOffice 无界面会话未能启动。")
        service_manager = context.ServiceManager
        desktop = service_manager.createInstanceWithContext(
            "com.sun.star.frame.Desktop", context
        )
        document = desktop.loadComponentFromURL(
            uno.systemPathToFileUrl(str(output_path)),
            "_blank",
            0,
            (prop("Hidden", True), prop("ReadOnly", False)),
        )
        if document is None:
            raise RuntimeError("LibreOffice 无法打开 DOCX 副本。")

        results = []
        for replacement in request["replacements"]:
            source = str(replacement["from"])
            target = str(replacement["to"])
            match_case = bool(replacement.get("matchCase", True))
            before = count_matches(document, source, match_case)
            if before == 0:
                raise RuntimeError(f"没有找到要替换的原文：{source}")
            expected = replacement.get("expectedCount")
            if expected is not None and before != int(expected):
                raise RuntimeError(
                    f"原文出现次数不符合预期：{source}，预期 {expected} 次，实际 {before} 次。"
                )
            descriptor = document.createReplaceDescriptor()
            descriptor.SearchString = source
            descriptor.ReplaceString = target
            descriptor.SearchCaseSensitive = match_case
            replaced = int(document.replaceAll(descriptor))
            if replaced != before:
                raise RuntimeError(
                    f"替换数量核对失败：{source}，找到 {before} 次，替换 {replaced} 次。"
                )
            verified = count_matches(document, target, match_case) if target else 0
            if target and verified < replaced:
                raise RuntimeError(
                    f"替换后核对失败：{target}，至少应出现 {replaced} 次，实际 {verified} 次。"
                )
            results.append(
                {"from": source, "to": target, "count": replaced, "verifiedCount": verified}
            )
        document.store()
        document.close(True)
        document = None
        print(json.dumps({"ok": True, "replacements": results}, ensure_ascii=False))
    finally:
        if document is not None:
            try:
                document.close(True)
            except Exception:
                pass
        office.terminate()
        try:
            office.wait(timeout=5)
        except subprocess.TimeoutExpired:
            office.kill()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)
