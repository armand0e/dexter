import os
import time
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
from pydantic import BaseModel
from typing import Type, List, Optional
from langchain_core.tools import BaseTool
from langchain_core.messages import AIMessage
from openai import APIConnectionError

from dexter.prompts import DEFAULT_SYSTEM_PROMPT

# Initialize the OpenAI client (env-driven, defaults preserved)
_model_name = os.getenv("DEXTER_LLM_MODEL", "gpt-4.1")
_api_key = os.getenv("OPENAI_API_KEY")
_base_url = os.getenv("OPENAI_API_BASE")

if _base_url:
    llm = ChatOpenAI(model=_model_name, temperature=0, api_key=_api_key, base_url=_base_url)
else:
    llm = ChatOpenAI(model=_model_name, temperature=0, api_key=_api_key)

def call_llm(
    prompt: str,
    system_prompt: Optional[str] = None,
    output_schema: Optional[Type[BaseModel]] = None,
    tools: Optional[List[BaseTool]] = None,
) -> AIMessage:
  final_system_prompt = system_prompt if system_prompt else DEFAULT_SYSTEM_PROMPT
  
  prompt_template = ChatPromptTemplate.from_messages([
      ("system", final_system_prompt),
      ("user", "{prompt}")
  ])

  runnable = llm
  if output_schema:
      _method = os.getenv("DEXTER_LLM_STRUCTURED_OUTPUT_METHOD", "function_calling").strip().lower()
      if _method == "none":
          runnable = llm
      elif _method in ("function_calling", "json_schema"):
          runnable = llm.with_structured_output(output_schema, method=_method)
      else:
          runnable = llm.with_structured_output(output_schema, method="function_calling")
  elif tools:
      _tool_bind = os.getenv("DEXTER_LLM_TOOL_BIND", "bind").strip().lower()
      if _tool_bind == "bind":
          runnable = llm.bind_tools(tools)
      else:
          runnable = llm
  
  chain = prompt_template | runnable
  
  # Retry logic for transient connection errors
  for attempt in range(3):
      try:
          return chain.invoke({"prompt": prompt})
      except APIConnectionError as e:
          if attempt == 2:  # Last attempt
              raise
          time.sleep(0.5 * (2 ** attempt))  # 0.5s, 1s backoff
