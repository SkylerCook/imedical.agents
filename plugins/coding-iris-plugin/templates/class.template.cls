Class Example.Utility Extends %RegisteredObject
{

/// Return the display name; the caller validates business requirements.
ClassMethod GetDisplayName(patientName As %String) As %String
{
    s displayName = patientName
    q displayName
}

}
