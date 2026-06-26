#!/usr/bin/env python3
"""
Word 文档读取器
支持 .docx 和 .doc 格式的 Word 文档解析
"""

import argparse
import json
import sys
import traceback
import shutil
from datetime import datetime
from pathlib import Path

try:
    from docx import Document
    from docx.opc.constants import RELATIONSHIP_TYPE as RT
    DOCX_AVAILABLE = True
except ImportError:
    DOCX_AVAILABLE = False

try:
    import subprocess
    SUBPROCESS_AVAILABLE = True
except ImportError:
    SUBPROCESS_AVAILABLE = False


class WordReader:
    """Word 文档读取器"""

    def __init__(self, file_path):
        self.file_path = Path(file_path)
        self.document = None
        self.format_type = None
        self.encoding = 'utf-8'

        if not self.file_path.exists():
            raise FileNotFoundError(f"文件不存在: {file_path}")

        if self.file_path.suffix.lower() not in ['.docx', '.doc']:
            raise ValueError(f"不支持的文件格式: {self.file_path.suffix}")

    def read_docx(self):
        """读取 .docx 格式文档"""
        if not DOCX_AVAILABLE:
            raise Exception("缺少 python-docx 库。请安装：pip3 install python-docx")

        try:
            self.document = Document(str(self.file_path))
            self.format_type = 'docx'
            return True
        except Exception as e:
            raise Exception(f"读取 .docx 文件失败: {str(e)}")

    def read_doc(self):
        """读取 .doc 格式文档（使用 antiword）"""
        if not SUBPROCESS_AVAILABLE:
            raise Exception("缺少 subprocess 模块")

        if sys.platform == 'win32':
            raise Exception(
                "Windows 不支持直接读取 .doc 二进制格式。"
                "请将文档另存为 .docx，或在 WSL/Linux 环境中使用 antiword。"
            )

        antiword_path = shutil.which('antiword')
        if not antiword_path:
            raise Exception(
                "antiword 未安装。请安装 antiword: "
                "Ubuntu/Debian: sudo apt-get install antiword; "
                "macOS: brew install antiword"
            )

        try:
            result = subprocess.run(
                [antiword_path, str(self.file_path)],
                capture_output=True,
            )

            if result.returncode != 0:
                raise Exception(f"antiword 转换失败: {result.stderr.decode('utf-8', errors='replace')}")

            # 尝试 utf-8，失败则回退到 gbk
            try:
                text = result.stdout.decode('utf-8')
            except UnicodeDecodeError:
                text = result.stdout.decode('gbk', errors='replace')

            class TempDocument:
                def __init__(self, text):
                    self.text = text
                    self.paragraphs = [TempParagraph(p) for p in text.split('\n') if p.strip()]

            class TempParagraph:
                def __init__(self, text):
                    self.text = text

            self.document = TempDocument(text)
            self.format_type = 'doc'
            return True
        except Exception as e:
            raise Exception(f"读取 .doc 文件失败: {str(e)}")

    def read_metadata(self):
        """读取文档元数据"""
        metadata = {
            'filename': self.file_path.name,
            'size': f"{self.file_path.stat().st_size} bytes",
            'created': datetime.fromtimestamp(self.file_path.stat().st_ctime).isoformat(),
            'modified': datetime.fromtimestamp(self.file_path.stat().st_mtime).isoformat()
        }

        if self.format_type == 'docx' and hasattr(self.document, 'core_properties'):
            props = self.document.core_properties
            metadata.update({
                'title': getattr(props, 'title', ''),
                'author': getattr(props, 'author', ''),
                'subject': getattr(props, 'subject', ''),
                'keywords': getattr(props, 'keywords', ''),
                'comments': getattr(props, 'comments', ''),
                'application': getattr(props, 'application', ''),
                'category': getattr(props, 'category', '')
            })

        return metadata

    def extract_text(self):
        """提取文档文本"""
        text_content = []

        if self.format_type == 'docx':
            for para in self.document.paragraphs:
                if para.text.strip():
                    text_content.append(para.text)

            for table in self.document.tables:
                table_text = []
                for row in table.rows:
                    row_text = [cell.text.strip() for cell in row.cells]
                    table_text.append(' | '.join(row_text))
                text_content.append('\n'.join(table_text))

        else:  # doc 格式
            text_content = [para.text for para in self.document.paragraphs if para.text.strip()]

        return '\n\n'.join(text_content)

    def extract_tables(self):
        """提取表格数据"""
        tables = []

        if self.format_type == 'docx':
            for i, table in enumerate(self.document.tables):
                table_data = []
                for row in table.rows:
                    row_data = [cell.text.strip() for cell in row.cells]
                    table_data.append(row_data)
                tables.append({
                    'id': i + 1,
                    'rows': len(table.rows),
                    'columns': len(table.columns),
                    'data': table_data
                })

        return tables

    def extract_images(self):
        """提取图片信息"""
        images = []

        if self.format_type == 'docx':
            try:
                part = self.document.part
                image_parts = part.related_parts

                for rel in part.rels.values():
                    if rel.reltype == RT.IMAGE:
                        image_data = image_parts[rel.rId]._blob
                        ext = Path(rel.target_ref).suffix.lstrip('.') or 'png'
                        image_info = {
                            'id': rel.rId,
                            'filename': f"image_{rel.rId}.{ext}",
                            'size': f"{len(image_data)} bytes"
                        }
                        images.append(image_info)
            except Exception as e:
                # 图片提取失败时记录警告，但不中断主流程
                images.append({'warning': f"图片提取失败: {str(e)}"})

        return images

    def extract_all(self):
        """提取所有内容"""
        return {
            'metadata': self.read_metadata(),
            'format': self.format_type,
            'text': self.extract_text(),
            'tables': self.extract_tables(),
            'images': self.extract_images()
        }

    def _filter_result(self, result, extract_type):
        """根据 extract_type 过滤提取结果"""
        if extract_type == 'all':
            return result
        if extract_type == 'text':
            return {'text': result['text']}
        if extract_type == 'tables':
            return {'tables': result['tables']}
        if extract_type == 'images':
            return {'images': result['images']}
        if extract_type == 'metadata':
            return {'metadata': result['metadata']}
        return result

    def to_markdown(self, extract_type='all'):
        """转换为 Markdown 格式"""
        result = self.extract_all()
        filtered = self._filter_result(result, extract_type)
        md_content = []

        if 'metadata' in filtered:
            metadata = filtered['metadata']
            md_content.append(f"# {metadata['filename']}")
            md_content.append("")
            if metadata.get('title'):
                md_content.append(f"**标题**：{metadata['title']}")
            if metadata.get('author'):
                md_content.append(f"**作者**：{metadata['author']}")
            md_content.append(f"**文件大小**：{metadata['size']}")
            md_content.append(f"**创建时间**：{metadata['created']}")
            md_content.append(f"**修改时间**：{metadata['modified']}")
            md_content.append("")

        if 'text' in filtered and filtered['text']:
            md_content.append("## 正文内容")
            md_content.append("")
            md_content.append(filtered['text'])
            md_content.append("")

        if 'tables' in filtered and filtered['tables']:
            md_content.append("## 表格内容")
            md_content.append("")
            for table in filtered['tables']:
                md_content.append(f"### 表格 {table['id']} ({table['rows']}行 x {table['columns']}列)")
                md_content.append("")
                for row in table['data']:
                    md_row = " | ".join([str(cell) for cell in row])
                    md_content.append(f"| {md_row} |")
                md_content.append("")

        if 'images' in filtered and filtered['images']:
            md_content.append("## 图片列表")
            md_content.append("")
            for img in filtered['images']:
                if 'warning' in img:
                    md_content.append(f"- ⚠️ {img['warning']}")
                else:
                    md_content.append(f"- **{img['filename']}** ({img['size']})")
            md_content.append("")

        return '\n'.join(md_content)

    def to_text(self, extract_type='all'):
        """转换为纯文本格式"""
        result = self.extract_all()
        filtered = self._filter_result(result, extract_type)
        text_content = []

        if 'metadata' in filtered:
            metadata = filtered['metadata']
            text_content.append(f"文件：{metadata['filename']}")
            text_content.append("=" * 50)
            text_content.append("")
            for key, value in metadata.items():
                if value and key not in ['filename', 'size', 'created', 'modified']:
                    text_content.append(f"{key}：{value}")
            text_content.append("")

        if 'text' in filtered and filtered['text']:
            text_content.append("正文内容：")
            text_content.append("-" * 20)
            text_content.append(filtered['text'])
            text_content.append("")

        if 'tables' in filtered and filtered['tables']:
            text_content.append("表格内容：")
            text_content.append("-" * 20)
            for table in filtered['tables']:
                text_content.append(f"表格 {table['id']}:")
                for row in table['data']:
                    text_content.append("  " + " | ".join([str(cell) for cell in row]))
                text_content.append("")

        if 'images' in filtered and filtered['images']:
            text_content.append("图片列表：")
            text_content.append("-" * 20)
            for img in filtered['images']:
                if 'warning' in img:
                    text_content.append(f"  ⚠️ {img['warning']}")
                else:
                    text_content.append(f"  - {img['filename']} ({img['size']})")
            text_content.append("")

        return '\n'.join(text_content)


def _read_reader(reader, file_path):
    """根据扩展名调用对应的读取方法"""
    if file_path.suffix.lower() == '.docx':
        reader.read_docx()
    else:
        reader.read_doc()


def _extract_content(reader, format_type, extract_type):
    """根据输出格式提取内容"""
    if format_type == 'json':
        return reader.extract_all() if extract_type == 'all' else reader._filter_result(reader.extract_all(), extract_type)
    if format_type == 'markdown':
        return reader.to_markdown(extract_type)
    return reader.to_text(extract_type)


def main():
    parser = argparse.ArgumentParser(description='读取 Word 文档')
    parser.add_argument('path', help='文档路径或目录路径（批量模式）')
    parser.add_argument('--format', choices=['json', 'text', 'markdown'],
                        default='text', help='输出格式')
    parser.add_argument('--extract', choices=['text', 'tables', 'images', 'metadata', 'all'],
                        default='all', help='提取内容类型')
    parser.add_argument('--batch', action='store_true', help='批量处理模式')
    parser.add_argument('--output', help='输出文件路径')
    parser.add_argument('--encoding', default='utf-8', help='文本编码')

    args = parser.parse_args()

    try:
        if args.batch:
            path = Path(args.path)
            if not path.is_dir():
                print("错误：批量模式需要指定目录路径")
                sys.exit(1)

            word_files = []
            for ext in ['.docx', '.doc']:
                word_files.extend(path.glob(f"**/*{ext}"))

            if not word_files:
                print("未找到 Word 文档")
                sys.exit(0)

            print(f"找到 {len(word_files)} 个 Word 文档")

            results = {}
            for file_path in word_files:
                print(f"正在处理: {file_path}")
                try:
                    reader = WordReader(file_path)
                    _read_reader(reader, file_path)
                    content = _extract_content(reader, args.format, args.extract)

                    results[str(file_path)] = {
                        'filename': file_path.name,
                        'content': content,
                        'status': 'success'
                    }

                except Exception as e:
                    results[str(file_path)] = {
                        'filename': file_path.name,
                        'error': str(e),
                        'status': 'failed'
                    }

            if args.output:
                with open(args.output, 'w', encoding='utf-8') as f:
                    json.dump(results, f, ensure_ascii=False, indent=2)
                print(f"结果已保存到: {args.output}")
            else:
                print(json.dumps(results, ensure_ascii=False, indent=2))

        else:
            reader = WordReader(args.path)
            _read_reader(reader, Path(args.path))
            content = _extract_content(reader, args.format, args.extract)

            if args.output:
                with open(args.output, 'w', encoding=args.encoding) as f:
                    if args.format == 'json':
                        json.dump(content, f, ensure_ascii=False, indent=2)
                    else:
                        f.write(content)
                print(f"结果已保存到: {args.output}")
            else:
                if args.format == 'json':
                    print(json.dumps(content, ensure_ascii=False, indent=2))
                else:
                    print(content)

    except Exception as e:
        print(f"错误: {str(e)}", file=sys.stderr)
        if '--debug' in sys.argv or '-d' in sys.argv:
            traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
