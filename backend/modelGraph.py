import os

from sqlalchemy_data_model_visualizer import (
    add_web_font_and_interactivity,
    generate_data_model_diagram,
)

from app.core.database import Base

os.environ["PATH"] += os.pathsep + r"C:\Program Files\Graphviz\bin"


model_classes = [mapper.class_ for mapper in Base.registry.mappers]

output_file_name = "my_data_model_diagram"

# Pass the extracted classes instead of Base.metadata.sorted_tables
generate_data_model_diagram(model_classes, output_file_name)

# Inject fonts and interactivity
add_web_font_and_interactivity(
    "my_data_model_diagram.svg", "my_interactive_data_model_diagram.svg"
)

print("Success! Diagrams generated.")
