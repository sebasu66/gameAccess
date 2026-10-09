import pathlib, re

p = pathlib.Path('apps/api/tests/test_digital_admin.py')
c = p.read_text('utf-8')

# Remove tests that test deleted endpoints
c = re.sub(r'def test_get_sources\(.*?(?=def test_|$)', '', c, flags=re.DOTALL)
c = re.sub(r'def test_add_and_delete_source\(.*?(?=def test_|$)', '', c, flags=re.DOTALL)
c = re.sub(r'def test_import_hydra_source_json\(.*?(?=def test_|$)', '', c, flags=re.DOTALL)
c = re.sub(r'def test_import_direct_hydra_json_payload\(.*?(?=def test_|$)', '', c, flags=re.DOTALL)
c = re.sub(r'def test_digital_source_resolution\(.*?(?=def test_|$)', '', c, flags=re.DOTALL)
c = re.sub(r'def test_update_source_priority_endpoint\(.*?(?=def test_|$)', '', c, flags=re.DOTALL)

p.write_text(c, 'utf-8')
print("Cleaned test_digital_admin.py")
