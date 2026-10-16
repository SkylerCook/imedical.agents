/// Name: Display name utilities
/// Description: Provides a minimal name passthrough example.
Class Example.Utility Extends %RegisteredObject
{

/// Name: Return a display name
/// Param: patientName | Name supplied by the caller; returned unchanged.
/// Return: String containing the input name, without formatting or validation.
/// Debug: w ##class(Example.Utility).GetDisplayName("Sample")
ClassMethod GetDisplayName(patientName As %String) As %String
{
    s displayName = patientName
    q displayName
}

}
