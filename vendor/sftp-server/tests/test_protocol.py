"""Offline stdio MCP integration; no SSH connections."""
import asyncio
import os
from pathlib import Path
import sys
import unittest

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class ProtocolTests(unittest.TestCase):
    def test_stdio_schema_errors_and_resources(self):
        async def run():
            source = Path(__file__).resolve().parents[1] / 'src/main.py'
            async with stdio_client(StdioServerParameters(command=sys.executable, args=['-B', str(source)],
                env={'LOCAL_PATH': str(source.parent), 'REMOTE_PATH': '/web', 'PYTHONDONTWRITEBYTECODE': '1'})) as (r, w):
                async with ClientSession(r, w) as session:
                    await session.initialize()
                    tools = await session.list_tools()
                    self.assertEqual(len(tools.tools), 5)
                    for tool in tools.tools:
                        for field in tool.inputSchema['properties'].values():
                            self.assertNotIn('description=', field)
                    result = await session.call_tool('read_remote_file', {'remote_file_path': '/outside'})
                    self.assertTrue(result.isError)
                    result = await session.call_tool('execute_remote_command', {'command': 'pwd'})
                    self.assertTrue(result.isError)
                    resource = await session.read_resource('sftp://config')
                    self.assertIn('reject-unknown', resource.contents[0].text)
        asyncio.run(run())


if __name__ == '__main__':
    unittest.main()
