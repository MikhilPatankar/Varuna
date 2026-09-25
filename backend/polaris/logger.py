import logging
import sys

def get_logger(name: str = "polaris") -> logging.Logger:
    """
    Creates and returns a pre-configured logger with standard formatting.
    """
    logger = logging.getLogger(name)
    
    # Only configure if it doesn't already have handlers to avoid duplication
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        
        # Create console handler
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.INFO)
        
        # Create formatter and add it to the handler
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - [%(levelname)s] - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        console_handler.setFormatter(formatter)
        
        # Add the handler to the logger
        logger.addHandler(console_handler)
        
        # Prevent log messages from being propagated to the root logger
        logger.propagate = False
        
    return logger

# Create a default instance for direct importing if needed
logger = get_logger()
