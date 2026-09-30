import os

frontend_dir = r'e:\PROJECT\POLARIS\frontend'
for root, _, files in os.walk(frontend_dir):
    if 'node_modules' in root:
        continue
    for file in files:
        if not file.endswith(('.jsx', '.js', '.html', '.css')):
            continue
        filepath = os.path.join(root, file)
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Replace occurrences of Varun with Varuna
        content = content.replace('VARUN', 'VARUNA')
        content = content.replace('Varun', 'Varuna')
        content = content.replace('varun', 'varuna')
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)

print('Done replacement to Varuna')
