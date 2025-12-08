import { logInfo, logError, showAlert } from './testHelpers';

describe('Logger Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('logInfo logs message with INFO prefix', () => {
    logInfo('Test message');
    
    expect(Logger.log).toHaveBeenCalledWith('[INFO] Test message');
  });

  test('logError logs error message with ERROR prefix', () => {
    const error = new Error('Test error');
    logError('Error occurred', error);
    
    expect(Logger.log).toHaveBeenCalledWith('[ERROR] Error occurred -> Error: Test error');
  });

  test('showAlert displays message using SpreadsheetApp UI', () => {
    showAlert('Test alert');
    
    expect(SpreadsheetApp.getUi().alert).toHaveBeenCalledWith('Test alert');
  });
});