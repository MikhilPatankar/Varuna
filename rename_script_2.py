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
        
        # Replace occurrences of Polaris with Varun in text content
        content = content.replace('>Polaris<', '>Varun<')
        content = content.replace('Polaris brings', 'Varun brings')
        content = content.replace('Polaris aggregates', 'Varun aggregates')
        content = content.replace('polaris-modal', 'varun-modal')
        content = content.replace('brand-text">POLARIS', 'brand-text">VARUN')
        content = content.replace('Polaris_Capture', 'Varun_Capture')
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)

print('Done replacement 2')
